
import re

# Mock content that might cause issues (Abstract at start)
# Hypotehsis: Regex `[\s\S]*?` is too greedy if it doesn't find the specific end marker
content = """# Jill Watson: A Virtual Teaching Assistant powered by ChatGPT

Karan Taneja, Pratyusha Maiti, Sandeep Kakar, Pranav Guruprasad, Sanjeev Rao, and Ashok K. Goel

Georgia Institute of Technology, Atlanta, GA {ktaneja6, pmaiti6, skakar6, pguruprasad7, srao373, ag25}@gatech.edu

Abstract. Conversational AI agents often require extensive datasets for training that are not publicly released, are limited to social chit-chat or handling a specific domain, and may not be easily extended to accommodate th

1 Introduction
Many classes use online discussion forums (like Piazza and EdStem) to facilitate asynchronous communication between students and instructors.
"""

def test_regex():
    # JS Regex approximation
    pattern = r'(?:^|\n)(?:#+\s*|\*\*)?(?:Abstract|摘要)(?:\*\*|:|—|\.|：)?\s*(?:[\r\n]+)?([\s\S]*?)(?:(?:\r?\n){2,}|\n(?=#))'
    
    match = re.search(pattern, content, re.IGNORECASE)
    
    if match:
        print("Match Found!")
        print(f"Captured Abstract: '{match.group(1)}'")
        
        end_index = match.end()
        remaining = content[end_index:]
        print(f"Remaining Body: '{remaining}'")
        
        if not remaining.strip():
            print("FAIL: Body consumed by Abstract match")
    else:
        print("No Match")

test_regex()
