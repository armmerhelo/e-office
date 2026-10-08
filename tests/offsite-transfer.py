"""Bounded FTPS framing, retry cleanup and exclusive worker ownership."""
import base64
import hashlib
import importlib.util
import io
import json
import os
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('offsite',ROOT/'scripts/offsite-snapshot.py')
offsite=importlib.util.module_from_spec(spec);spec.loader.exec_module(offsite)

class Reader(io.BytesIO):
    def __init__(self,data,connection):super().__init__(data);self.connection=connection
    def read(self,size=-1):
        data=super().read(size)
        if data==b'':self.connection.eof=True
        return data
class Connection:
    def __init__(self,data):self.data=data;self.eof=False;self.unwrapped=False
    def settimeout(self,value):pass
    def makefile(self,mode):return Reader(self.data,self)
    def unwrap(self):
        assert self.eof,'Must consume data EOF before TLS shutdown'
        self.unwrapped=True;return self
    def close(self):pass
class FTP:
    def __init__(self,data):self.data=data;self.sock=object();self.responses=0;self.rest=None
    def voidcmd(self,command):assert command=='TYPE I'
    def transfercmd(self,command,rest=None):
        self.rest=rest;self.connection=Connection(self.data[rest or 0:]);return self.connection
    def voidresp(self):assert self.connection.unwrapped;self.responses+=1
    def close(self):self.sock=None

temporary=Path(tempfile.gettempdir())/'opencode';temporary.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='offsite-transfer-',dir=temporary) as directory:
    folder=Path(directory);offsite.STATE=folder/'state.private.json'
    state={'directory':str(folder),'key_b64':base64.b64encode(os.urandom(32)).decode()}
    source=os.urandom(80000);entry={'remote':'/private/synthetic.pdf','size':len(source)}
    ftp=FTP(source)
    part=offsite.encrypt_part(ftp,entry,0,len(source),folder/'full.ebak',state)
    assert part['plaintext_sha256']==hashlib.sha256(source).hexdigest() and ftp.responses==1 and ftp.sock is not None
    second=offsite.encrypt_part(ftp,entry,0,len(source),folder/'second.ebak',state)
    assert ftp.responses==2 and second['plaintext_sha256']==part['plaintext_sha256']
    print('PASS full FTPS transfer consumes EOF/226 and safely reuses control connection')
    ftp=FTP(source)
    part=offsite.encrypt_part(ftp,entry,0,40000,folder/'slice.ebak',state)
    assert ftp.sock is None and ftp.responses==0 and part['length']==40000
    ftp=FTP(source)
    tail=offsite.encrypt_part(ftp,entry,40000,40000,folder/'tail.ebak',state)
    assert ftp.rest==40000 and tail['plaintext_sha256']==hashlib.sha256(source[40000:]).hexdigest()
    print('PASS bounded slice discards FTP session and REST resumes at the exact offset')
    empty=offsite.encrypt_part(FTP(b''),{'remote':'/private/empty','size':0},0,0,folder/'empty.ebak',state)
    assert empty['length']==0
    target=folder/'short.ebak'
    try:offsite.encrypt_part(FTP(b'short'),entry,0,len(source),target,state)
    except RuntimeError:assert not target.exists() and not Path(str(target)+'.partial').exists()
    else:raise AssertionError('Short transfer accepted')
    print('PASS empty file authenticated and short transfer never publishes a part')
    offsite.STATE.write_text(json.dumps(state),encoding='utf-8')
    real=offsite._run
    def competing_worker(deadline,state):
        try:offsite.run(1)
        except OSError:return
        raise AssertionError('Concurrent worker acquired the same backup')
    offsite._run=competing_worker
    try:offsite.run(1)
    finally:offsite._run=real
    print('PASS exclusive worker lock prevents concurrent writers for one snapshot')
    canonical=folder/'000000-000000000000.ebak'
    canonical.write_bytes((folder/'full.ebak').read_bytes())
    saved={'size':len(source),'parts':[{'archive':canonical.name,'offset':0,'length':len(source),'archive_sha256':offsite.digest(canonical),'plaintext_sha256':part['plaintext_sha256']}]}
    saved['parts'][0]['plaintext_sha256']=hashlib.sha256(source).hexdigest()
    assert offsite.saved_offset(saved,0,folder,state)==len(source)
    for field,value in [('offset',1),('length',len(source)+1),('archive','../escape.ebak'),('plaintext_sha256','0'*64)]:
        original=saved['parts'][0][field];saved['parts'][0][field]=value
        try:offsite.saved_offset(saved,0,folder,state)
        except RuntimeError:pass
        else:raise AssertionError('Invalid saved manifest accepted: '+field)
        saved['parts'][0][field]=original
    print('PASS resume authenticates saved bytes and rejects invalid offsets, lengths and paths')
