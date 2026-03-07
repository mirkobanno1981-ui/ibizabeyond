import json
import time
import urllib.request
import re
from playwright.sync_api import sync_playwright

def strip_tags(text):
    if not text:
        return ''
    return re.sub('<[^<]+?>', '', text)

def run():
    with open('ibiza_villas.json', 'r', encoding='utf-8') as f:
        villas = json.load(f)
        
    print(f"Loaded {len(villas)} Ibiza villas from Invenio.")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        
        print("Logging into WP Admin...")
        page.goto("http://72.60.38.114:8080/wp-admin/")
        page.fill("#user_login", "admin")
        page.fill("#user_pass", "Ibiza62447881%%")
        page.click("#wp-submit")
        page.wait_for_load_state("networkidle")
        
        print("Scraping property IDs from WP Admin...")
        wp_props = {}
        page_num = 1
        while True:
            page.goto(f"http://72.60.38.114:8080/wp-admin/edit.php?post_type=estate_property&paged={page_num}")
            page.wait_for_load_state("networkidle")
            
            # Check if there are rows
            rows = page.locator("tr.hentry")
            count = rows.count()
            if count == 0:
                break
                
            for i in range(count):
                row = rows.nth(i)
                title_elem = row.locator(".row-title")
                title = title_elem.inner_text().replace('&#8211;', '-').replace('&#8217;', "'").strip().lower()
                href = title_elem.get_attribute("href")
                # href = "post.php?post=33443&action=edit"
                if "post=" in href:
                    pid = href.split("post=")[1].split("&")[0]
                    wp_props[title] = pid
                    
            print(f"Scraped page {page_num}, total found: {len(wp_props)}")
            
            # Check if next page exists
            next_btn = page.locator(".tablenav.top .next-page")
            if next_btn.count() == 0:
                break
            btn_class = next_btn.get_attribute("class") or ""
            if "disabled" in btn_class:
                break
            page_num += 1
        
        updated_count = 0
        missing_count = 0
        
        for villa in villas:
            # Clean up the name
            name = strip_tags(villa.get('name', '')).strip()
            
            if not name:
                print("SKIPPING: Empty villa name in JSON record")
                missing_count += 1
                continue
                
            # Map rule values
            min_nights = str(villa.get('min_nights', ''))
            deposit = str(villa.get('deposit', '')).replace('.00', '')
            checkin_rule = villa.get('allowed_checkin_days', '')
            
            # Decide checkin select value
            # 0: All, 6: Saturday
            if "Saturday" in checkin_rule:
                checkin_val = "6"
            else:
                checkin_val = "0"
            
            wp_id = wp_props.get(name.lower())
            
            if not wp_id and len(name) > 3:
                # Try partial match or alternate spaces
                for title_lower, pid in wp_props.items():
                    if name.lower() in title_lower or title_lower in name.lower():
                        wp_id = pid
                        break
            
            if not wp_id:
                print(f"SKIPPING: '{name}' not found in WP Rentals")
                missing_count += 1
                continue
                
            print(f"Updating '{name}' (ID: {wp_id}) - MinNights:{min_nights}, Deposit:{deposit}, Checkin:{checkin_val}")
            
            edit_url = f"http://72.60.38.114:8080/wp-admin/post.php?post={wp_id}&action=edit"
            page.goto(edit_url)
            
            try:
                page.wait_for_selector("#min_days_booking", timeout=10000)
                
                # Fill values
                if min_nights:
                    page.fill("#min_days_booking", min_nights)
                if deposit:
                    page.fill("#security_deposit", deposit)
                    
                page.select_option("#checkin_change_over", value=checkin_val)
                
                # Click update
                page.click("#publish")
                page.wait_for_selector("#message.updated", timeout=15000)
                print(f"  -> SUCCESS")
                updated_count += 1
                
            except Exception as e:
                print(f"  -> ERROR updating '{name}': {e}")
                
        print(f"\n--- SUMMARY ---")
        print(f"Villas updated: {updated_count}")
        print(f"Villas not found in WP: {missing_count}")
        
        browser.close()

if __name__ == "__main__":
    run()
