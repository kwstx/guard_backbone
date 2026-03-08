import os
import sys
import webview # Requires: pip install pywebview

def run_gui():
    # Get the absolute path to the dashboard.html file
    current_dir = os.path.dirname(os.path.abspath(__file__))
    dashboard_path = os.path.join(current_dir, "dashboard.html")
    
    if not os.path.exists(dashboard_path):
        print(f"Error: Could not find {dashboard_path}")
        sys.exit(1)

    # Create a native window
    # Note: On Windows, this uses Edge Chromium (WebView2)
    window = webview.create_window(
        title='Guard Backbone | Security Ledger',
        url=dashboard_path,
        width=1200,
        height=800,
        min_size=(1000, 700),
        confirm_close=True,
        background_color='#ffffff'
    )

    print("Launching Guard Backbone Desktop UI...")
    webview.start(debug=True)

if __name__ == "__main__":
    run_gui()
