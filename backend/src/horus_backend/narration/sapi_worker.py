"""Reutiliza o wrapper COM existente, sempre em processo separado."""
import ctypes as c
import json
import locale
import sys
from pathlib import Path
from horus_backend import local_pilot_windows as sapi


def main():
    sapi.ole = c.OleDLL('ole32')
    automation = c.WinDLL('oleaut32')
    sapi.ole.CoCreateInstance.argtypes = [c.POINTER(sapi.GUID), c.c_void_p, c.c_ulong, c.POINTER(sapi.GUID), c.POINTER(c.c_void_p)]
    sapi.ole.SysAllocString = automation.SysAllocString
    sapi.ole.SysAllocString.argtypes, sapi.ole.SysAllocString.restype = [sapi.w.LPCWSTR], c.c_void_p
    sapi.ole.VariantClear = automation.VariantClear
    sapi.ole.VariantClear.argtypes = [c.POINTER(sapi.Variant)]
    sapi.check(sapi.ole.CoInitializeEx(None, 2))
    objects = []
    try:
        voice = sapi.Dispatch.create('96749377-3391-11d2-9ee3-00c04f797396'); objects.append(voice)
        tokens = voice.invoke('GetVoices', '', ''); objects.append(tokens)
        voices = []
        selected = None
        request = json.loads(sys.stdin.read())
        for i in range(tokens.invoke('Count', flags=2)):
            token = tokens.invoke('Item', i); objects.append(token)
            ident = token.invoke('Id', flags=2)
            language = token.invoke('GetAttribute', 'Language').split(';')[0]
            voices.append({'id': ident, 'name': token.invoke('GetDescription', 0),
                           'language': locale.windows_locale.get(int(language, 16), 'und').replace('_', '-')})
            if ident == request.get('voice_id'): selected = token
        if request['action'] == 'voices':
            print(json.dumps(voices)); return
        if selected is None: raise ValueError('Voz não instalada')
        voice.invoke('Voice', selected, flags=8)
        stream = sapi.Dispatch.create('947812b3-2ae1-4644-ba86-9e90ded7ec91'); objects.append(stream)
        fmt = stream.invoke('Format', flags=2); objects.append(fmt)
        fmt.invoke('Type', 22, flags=4)
        stream.invoke('Open', str(Path(request['output']).resolve()), 3, False)
        try:
            voice.invoke('AudioOutputStream', stream, flags=8)
            voice.invoke('Speak', request['text'], 16)
        finally: stream.invoke('Close')
        print('{}')
    finally:
        for obj in reversed(objects): obj.close()
        sapi.ole.CoUninitialize()

if __name__ == '__main__':
    try: main()
    except Exception:
        sys.exit(1)  # Nunca emitir texto privado/erro de ferramenta.
