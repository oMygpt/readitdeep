import requests
import time

BASE_URL = "http://localhost:8000/api/v1"

def login(email, password):
    resp = requests.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password})
    if resp.status_code != 200:
        print(f"Login failed for {email}: {resp.text}")
        return None
    return resp.json()["access_token"]

def register_admin():
    # Only works if no users exist, otherwise login
    resp = requests.post(f"{BASE_URL}/auth/register", json={
        "email": "admin@readitdeep.com",
        "password": "admin123", 
        "username": "Admin"
    })
    if resp.status_code == 200:
        return resp.json()["access_token"]
    return login("admin@readitdeep.com", "admin123")

def register_user(admin_token, email, password):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = requests.post(f"{BASE_URL}/admin/users", headers=headers, json={
        "email": email,
        "password": password,
        "username": "TestUser",
        "role": "user"
    })
    if resp.status_code == 200 or resp.status_code == 400: # 400 if exists
        print(f"User {email} registered/exists")
        return login(email, password)
    print(f"Register failed: {resp.text}")
    return None

def upload_paper(token, filename):
    headers = {"Authorization": f"Bearer {token}"}
    files = {"file": (filename, b"dummy pdf content", "application/pdf")}
    resp = requests.post(f"{BASE_URL}/papers/upload", headers=headers, files=files)
    print(f"Upload {filename}: {resp.status_code}")
    return resp.status_code == 200

def list_library(token):
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/library/", headers=headers)
    if resp.status_code == 200:
        items = resp.json()["items"]
        print(f"Library count: {len(items)}")
        return len(items)
    print(f"List library failed: {resp.text}")
    return -1

def main():
    print("Waiting for server...")
    time.sleep(5)
    
    print("\n1. Admin Login")
    admin_token = register_admin()
    if not admin_token: return
    
    print("\n2. Admin Check Library")
    initial_count = list_library(admin_token)
    
    print("\n3. Admin Upload")
    upload_paper(admin_token, "admin_paper.pdf")
    
    print("\n4. Admin Check Library (Should +1)")
    new_count = list_library(admin_token)
    if new_count != initial_count + 1:
        print("FAIL: Admin upload not visible")
    else:
        print("PASS: Admin upload visible")
        
    print("\n5. Register New User")
    user_token = register_user(admin_token, "user1@test.com", "user123")
    if not user_token: return
    
    print("\n6. User Check Library (Should be 0 ideally, or just their own)")
    # Since we use a shared json file before, all existing papers might not have user_id and thus strictly filtered out or not?
    # Our code: if user_id is set, match. If not set, maybe visible?
    # Let's see store.py logic: if p.get("user_id") == user_id
    # Old papers have no user_id, so they won't match user_id check.
    # So user library should be 0.
    user_count = list_library(user_token)
    if user_count == 0:
        print("PASS: User library empty (Isolation working)")
    else:
        print(f"FAIL: User library has {user_count} items (Expected 0)")

    print("\n7. User Upload")
    upload_paper(user_token, "user_paper.pdf")
    
    print("\n8. User Check Library (Should be 1)")
    user_count_new = list_library(user_token)
    if user_count_new == 1:
        print("PASS: User sees their own paper")
    else:
        print(f"FAIL: User sees {user_count_new}")

    print("\n9. Admin Check Library (Should NOT see user paper in simple list, unless admin view)")
    # Current list_papers filters by current_user.id. Admin is just a user here unless we implemented special admin view.
    # In library.py: papers = store.get_by_user(current_user.id)
    # So Admin only sees Admin papers.
    admin_final_count = list_library(admin_token)
    if admin_final_count == new_count:
        print("PASS: Admin does not see user paper in my-library view")
    else:
        print(f"FAIL: Admin sees {admin_final_count} (Expected {new_count})")

if __name__ == "__main__":
    main()
