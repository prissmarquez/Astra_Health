import sys
from pathlib import Path

# Lets the tests import the modules in backend/IA.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
