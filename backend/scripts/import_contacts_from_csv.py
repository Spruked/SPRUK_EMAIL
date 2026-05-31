import csv
import requests
import os

# Path to your CSV file (update if needed)
CSV_PATH = os.path.expanduser(r"c:/Users/bryan/AppData/Local/Temp/MicrosoftEdgeDownloads/cd39e621-2413-4022-b014-931655c249da/contacts.csv")
API_URL = "http://localhost:19000/api/contacts"

# Map CSV columns to API fields
def extract_contact(row):
    email = (row.get("E-mail Address") or row.get("E-mail 2 Address") or row.get("E-mail 3 Address") or "").strip()
    name = (row.get("First Name", "").strip() + " " + row.get("Last Name", "").strip()).strip()
    if not name:
        name = email.split("@")[0] if email else ""
    # Accept contacts with just a name or just an email
    if not (email or name):
        return None
    # Phone: prefer Mobile, then Home, then Business, then Other
    phone = (row.get("Mobile Phone") or row.get("Home Phone") or row.get("Business Phone") or row.get("Other Phone") or "").strip()
    # Address: prefer Home, then Business, then Other
    address = ""
    for prefix in ["Home", "Business", "Other"]:
        street = row.get(f"{prefix} Street", "").strip()
        city = row.get(f"{prefix} City", "").strip()
        state = row.get(f"{prefix} State", "").strip()
        postal = row.get(f"{prefix} Postal Code", "").strip()
        country = row.get(f"{prefix} Country/Region", "").strip()
        if street or city or state or postal or country:
            address = ", ".join(filter(None, [street, city, state, postal, country]))
            break
    return {
        "email": email or None,
        "name": name or None,
        "phone": phone or None,
        "address": address or None,
        "contact_type": "marketing",
        "crm_stage": "prospect",
        "sync_crm": True
    }

def main():
    with open(CSV_PATH, newline='', encoding='utf-8') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            contact = extract_contact(row)
            if not contact:
                continue
            try:
                resp = requests.post(API_URL, json=contact)
                if resp.status_code == 200:
                    print(f"Imported: {contact.get('email') or contact.get('name')}")
                else:
                    print(f"Failed: {contact.get('email') or contact.get('name')} - {resp.status_code} {resp.text}")
            except Exception as e:
                print(f"Error importing {contact.get('email') or contact.get('name')}: {e}")

if __name__ == "__main__":
    main()
