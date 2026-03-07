from playwright.sync_api import sync_playwright

def run():
    print("Starting backend spider...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://72.60.38.114:8080/wp-admin/post.php?post=33443&action=edit")
        
        if page.locator("#user_login").is_visible():
            page.fill("#user_login", "admin")
            page.fill("#user_pass", "Ibiza62447881%%")
            page.click("#wp-submit")
            page.wait_for_load_state("networkidle")
            
        html = page.content()
        with open("backend_edit.html", "w", encoding="utf-8") as f:
            f.write(html)
        print("Backend HTML saved.")
        browser.close()

if __name__ == "__main__":
    run()
