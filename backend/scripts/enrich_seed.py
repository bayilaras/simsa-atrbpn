import json
import re

# Load JSON data
try:
    with open('klasifikasi_extracted.json', 'r', encoding='utf-8') as f:
        extracted_data = json.load(f)
    print(f"Loaded {len(extracted_data)} extracted items")
except Exception as e:
    print(f"Error loading JSON: {e}")
    exit(1)

# Load existing TS seed file
ts_path = 'backend/src/db/seed-klasifikasi.ts'
try:
    with open(ts_path, 'r', encoding='utf-8') as f:
        ts_content = f.read()
    print(f"Loaded TS file: {len(ts_content)} bytes")
except Exception as e:
    print(f"Error loading TS file: {e}")
    exit(1)

# Extract the data array content
start_marker = "const KLASIFIKASI_DATA = ["
end_marker = "];"
start_idx = ts_content.find(start_marker)
end_idx = ts_content.rfind(end_marker) # Find the last ]; which closes the array

if start_idx == -1 or end_idx == -1:
    print("Could not find KLASIFIKASI_DATA array in TS file")
    exit(1)

# Get the array content (text within [ ])
array_content = ts_content[start_idx + len(start_marker):end_idx]

# Split into lines/items
# Assuming one item per line roughly, or comma separated objects
# The file format is:   { kode: '...', ... },
# We can use regex to find each object
# pattern: { kode: '([^']*)', jenis: '([^']*)', keterangan: '([^']*)', ... }

# Create a lookup map for descriptions from JSON
# Key: code suffix (last part), Value: description
# Also need to handle fuzzy matching as '01.01' is common
# Better strategy: match by 'jenis' (title) first line
description_map = {}

for item in extracted_data:
    # item['jenis'] contains "Title\nDescription..."
    full_text = item.get('jenis', '').strip()
    if not full_text:
        continue
        
    parts = full_text.split('\n', 1)
    title = parts[0].strip()
    desc = parts[1].strip() if len(parts) > 1 else ''
    
    # Store by title (normalized)
    norm_title = title.lower().replace('.', '').strip()
    if norm_title:
        description_map[norm_title] = desc

print(f"Created map with {len(description_map)} descriptions")

# Function to update a single line
def update_line(line):
    # Regex to capture parts
    # { kode: 'PR.01.01', jenis: 'Perencanaan Umum', keterangan: '-', ... }
    match = re.search(r"kode: '([^']*)', jenis: '([^']*)', keterangan: '([^']*)'", line)
    if match:
        kode = match.group(1)
        jenis = match.group(2)
        old_ket = match.group(3)
        
        # Try to find description
        norm_jenis = jenis.lower().replace('.', '').strip()
        new_desc = description_map.get(norm_jenis)
        
        if new_desc:
            # Escape single quotes for JS string
            escaped_desc = new_desc.replace("'", "\\'").replace('\n', ' ')
            # Replace keterangan: '-' with real description
            # Use strict replacement to avoid messing up other fields
            new_line = line.replace(f"keterangan: '{old_ket}'", f"keterangan: '{escaped_desc}'")
            return new_line, True
            
    return line, False

# Process TS content line by line
new_lines = []
updated_count = 0
lines = ts_content.split('\n')

for line in lines:
    if "kode: '" in line and "jenis: '" in line:
        new_line, updated = update_line(line)
        if updated:
            updated_count += 1
        new_lines.append(new_line)
    else:
        new_lines.append(line)

print(f"Updated {updated_count} descriptions")

# Write back
with open(ts_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(new_lines))

print("Done writing to seed-klasifikasi.ts")
