#!/usr/bin/env python3
"""Execute the runner's actual inventory-admission AST; never builds or launches."""
import ast, hashlib, json, tempfile, types, unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
SOURCE=HERE/'run.py'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
tree=ast.parse(SOURCE.read_text())
guards=[node for node in ast.walk(tree) if isinstance(node,ast.If) and ast.unparse(node.test)=='args.verified_native_source_inventory']
assert len(guards)==1,'Exactly one actual runner inventory guard required'
GUARD=compile(ast.Module(body=guards,type_ignores=[]),str(SOURCE),'exec')
class ReuseInventoryTests(unittest.TestCase):
 def test_wrong_digest_refused(self):
  with tempfile.TemporaryDirectory(prefix='thingtime-reuse-refusal-') as directory:
   inventory=Path(directory)/'inventory.json';inventory.write_text('{}')
   args=types.SimpleNamespace(verified_native_source_inventory=inventory,native_source_inventory_sha256='0'*64)
   with self.assertRaisesRegex(RuntimeError,'Frozen native source inventory digest mismatch'):
    exec(GUARD,{'args':args,'sha':sha,'ROOT':ROOT,'json':json,'known':{},'exceptions':set()})
 def test_changed_source_refused(self):
  with tempfile.TemporaryDirectory(prefix='thingtime-reuse-refusal-') as directory:
   inventory=Path(directory)/'inventory.json'
   inventory.write_text(json.dumps({'iOS/scripts/local-development/entry.mjs':'0'*64}))
   args=types.SimpleNamespace(verified_native_source_inventory=inventory,native_source_inventory_sha256=sha(inventory))
   with self.assertRaisesRegex(RuntimeError,'Frozen source changed: iOS/scripts/local-development/entry.mjs'):
    exec(GUARD,{'args':args,'sha':sha,'ROOT':ROOT,'json':json,'known':{},'exceptions':set()})
if __name__=='__main__':unittest.main()
