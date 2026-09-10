"""Synthetic localhost TLS fixture. Never use with real credentials."""
import json, ssl, threading, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
root=Path(sys.argv[1]).resolve()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self):
  print(json.dumps({'port':self.server.server_port,'path':self.path,'synthetic_auth':self.headers.get('Authorization')=='Bearer synthetic-public-probe'}),flush=True)
  if self.path in ['/redirect-same','/redirect-cross']:
   port=8843 if self.path.endswith('same') else 8844
   self.send_response(302); self.send_header('Location',f'https://localhost:{port}/target');self.end_headers()
  else:
   self.send_response(200);self.end_headers();self.wfile.write(b'SYNTHETIC TLS OK')
servers=[]
for port,cert in [(8843,'server'),(8844,'server'),(8845,'untrusted')]:
 server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
 ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(root/f'{cert}.crt',root/f'{cert}.key')
 server.socket=ctx.wrap_socket(server.socket,server_side=True);servers.append(server)
 threading.Thread(target=server.serve_forever,daemon=True).start()
print('synthetic TLS fixture ready',flush=True)
threading.Event().wait()
