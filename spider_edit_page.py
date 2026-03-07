from playwright.sync_api import sync_playwright
import time

def run():
    print("Starting browser...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        print("Logging in...")
        page.goto("http://72.60.38.114:8080/wp-admin/")
        page.fill("#user_login", "admin")
        page.fill("#user_pass", "Ibiza62447881%%")
        page.click("#wp-submit")
        page.wait_for_selector("h1:has-text('Dashboard')")
        
        edit_url = "http://72.60.38.114:8080/add-new-listing/?edit_id=33443"
        print(f"Visiting Edit URL: {edit_url}")
        
        page.goto(edit_url)
        page.wait_for_load_state("networkidle")
        
        print("Clicking Price tab...")
        page.locator("a:has-text('Price')").click()
        time.sleep(2) # wait for tab content
        
        print("Dumping HTML...")
        html = page.content()
        with open("edit_page.html", "w", encoding="utf-8") as f:
            f.write(html)
            
        browser.close()
        print("Done!")

if __name__ == "__main__":
    run()
