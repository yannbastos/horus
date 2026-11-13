"""Helper Windows nativo isolado: COM SAPI e PNG/GDI, sem PowerShell ou rede."""
from __future__ import annotations
import ctypes as c
from ctypes import wintypes as w
import json
from pathlib import Path
import struct
import sys
import uuid
import zlib


class GUID(c.Structure):
    _fields_ = [('data', c.c_ubyte * 16)]
    def __init__(self, value):
        super().__init__((c.c_ubyte * 16).from_buffer_copy(uuid.UUID(value).bytes_le))


class Value(c.Union):
    _fields_ = [('integer', c.c_long), ('boolean', c.c_short), ('pointer', c.c_void_p),
                ('record', c.c_void_p * 2)]


class Variant(c.Structure):
    _fields_ = [('vt', c.c_ushort), ('reserved', c.c_ushort * 3), ('value', Value)]


class Params(c.Structure):
    _fields_ = [('args', c.POINTER(Variant)), ('named', c.POINTER(c.c_long)),
                ('count', c.c_uint), ('named_count', c.c_uint)]


IID_DISPATCH = GUID('00020400-0000-0000-c000-000000000046')
IID_NULL = GUID('00000000-0000-0000-0000-000000000000')
ole = None


def check(hr):
    if hr < 0:
        raise OSError(f'Windows HRESULT 0x{hr & 0xffffffff:08x}')


class Dispatch:
    def __init__(self, pointer):
        self.pointer = c.c_void_p(pointer)

    def function(self, index, result, *args):
        table = c.cast(self.pointer, c.POINTER(c.POINTER(c.c_void_p))).contents
        return c.WINFUNCTYPE(result, c.c_void_p, *args)(table[index])

    @classmethod
    def create(cls, identifier):
        pointer = c.c_void_p()
        check(ole.CoCreateInstance(c.byref(GUID(identifier)), None, 1, c.byref(IID_DISPATCH), c.byref(pointer)))
        return cls(pointer.value)

    def close(self):
        if self.pointer:
            self.function(2, c.c_ulong)(self.pointer)
            self.pointer = c.c_void_p()

    def invoke(self, name, *arguments, flags=1):
        identifier = c.c_long()
        names = (w.LPWSTR * 1)(name)
        check(self.function(5, c.c_long, c.POINTER(GUID), c.POINTER(w.LPWSTR), c.c_uint,
            c.c_ulong, c.POINTER(c.c_long))(self.pointer, c.byref(IID_NULL), names, 1, 0, c.byref(identifier)))
        values = (Variant * len(arguments))()
        for value, argument in zip(values, reversed(arguments)):
            if isinstance(argument, Dispatch):
                value.vt, value.value.pointer = 9, argument.pointer.value
            elif isinstance(argument, bool):
                value.vt, value.value.boolean = 11, -1 if argument else 0
            elif isinstance(argument, int):
                value.vt, value.value.integer = 3, argument
            elif isinstance(argument, str):
                value.vt, value.value.pointer = 8, ole.SysAllocString(argument)
                if not value.value.pointer:
                    raise MemoryError('BSTR')
            else:
                raise TypeError('Unsupported COM argument')
        named = c.c_long(-3)  # DISPID_PROPERTYPUT
        params = Params(values, c.pointer(named) if flags in (4, 8) else None, len(values), 1 if flags in (4, 8) else 0)
        result = Variant()
        try:
            check(self.function(6, c.c_long, c.c_long, c.POINTER(GUID), c.c_ulong, c.c_ushort,
                c.POINTER(Params), c.POINTER(Variant), c.c_void_p, c.c_void_p)(self.pointer,
                identifier, c.byref(IID_NULL), 0, flags, c.byref(params), c.byref(result), None, None))
            if result.vt == 9:
                dispatch = Dispatch(result.value.pointer)
                result.vt = 0  # transfere referência para Dispatch
                return dispatch
            if result.vt == 8:
                return c.wstring_at(result.value.pointer)
            if result.vt in (2, 3, 22):
                return result.value.integer
            if result.vt == 0:
                return None
            raise ValueError(f'COM result type {result.vt}')
        finally:
            ole.VariantClear(c.byref(result))
            for value in values:
                # Dispatch de argumento é emprestado; strings pertencem a este invoke.
                if value.vt == 8:
                    ole.VariantClear(c.byref(value))


SCENE_REGIONS = {
    'label': (220, 250, 860, 305),
    'heading': (220, 340, 860, 600),
    'summary': (220, 680, 860, 1020),
    'disclosure': (240, 1620, 840, 1685),
    'accent': (180, 250, 190, 1020),
}


def transformed_bounds(bounds, progress, direction):
    # CSS scale(s) translate(p%): centro + s*(ponto-centro + deslocamento).
    scale = 1 + .15*progress
    dx,dy = {'esquerda':(-.03*progress*1080,0),'direita':(.03*progress*1080,0),
             'cima':(0,-.03*progress*1920),'baixo':(0,.03*progress*1920)}[direction]
    left,top,right,bottom = bounds
    return (540+scale*(left-540+dx),960+scale*(top-960+dy),
            540+scale*(right-540+dx),960+scale*(bottom-960+dy))


def wrap_measured(text, measure, width):
    """Quebra por palavras/caracteres medidos, sem descartar texto."""
    lines, current = [], ''
    for word in text.split():
        candidate = (current+' '+word).strip()
        if measure(candidate) <= width:
            current = candidate
            continue
        if current:
            lines.append(current)
            current = ''
        for char in word:
            if measure(current+char) > width:
                if not current:
                    raise ValueError('Caractere não cabe na área segura.')
                lines.append(current)
                current = char
            else:
                current += char
    if current:
        lines.append(current)
    return lines


def scene(path, section):
    """Texto e geometria originais em bitmap local; não é outro motor de vídeo."""
    gdi, user = c.WinDLL('gdi32', use_last_error=True), c.WinDLL('user32', use_last_error=True)
    for name, result, args in [
        ('CreateCompatibleDC',w.HDC,[w.HDC]), ('CreateCompatibleBitmap',w.HBITMAP,[w.HDC,c.c_int,c.c_int]),
        ('SelectObject',w.HANDLE,[w.HDC,w.HANDLE]), ('CreateSolidBrush',w.HBRUSH,[w.DWORD]),
        ('CreateFontW',w.HFONT,[c.c_int,c.c_int,c.c_int,c.c_int,c.c_int,w.DWORD,w.DWORD,w.DWORD,w.DWORD,w.DWORD,w.DWORD,w.DWORD,w.DWORD,w.LPCWSTR]),
        ('DeleteObject',w.BOOL,[w.HANDLE]), ('DeleteDC',w.BOOL,[w.HDC]),
        ('SetTextColor',w.DWORD,[w.HDC,w.DWORD]), ('SetBkMode',c.c_int,[w.HDC,c.c_int]),
        ('GetDIBits',c.c_int,[w.HDC,w.HBITMAP,w.UINT,w.UINT,c.c_void_p,c.c_void_p,w.UINT])]:
        fn = getattr(gdi,name); fn.restype, fn.argtypes = result,args
    user.GetDC.argtypes, user.GetDC.restype = [w.HWND],w.HDC
    user.ReleaseDC.argtypes = [w.HWND,w.HDC]
    user.FillRect.argtypes = [w.HDC,c.POINTER(w.RECT),w.HBRUSH]
    user.DrawTextW.argtypes = [w.HDC,w.LPCWSTR,c.c_int,c.POINTER(w.RECT),w.UINT]
    gdi.GetTextExtentPoint32W.argtypes = [w.HDC,w.LPCWSTR,c.c_int,c.POINTER(w.SIZE)]
    screen = user.GetDC(None)
    dc = gdi.CreateCompatibleDC(screen)
    bitmap = gdi.CreateCompatibleBitmap(screen,1080,1920)
    user.ReleaseDC(None,screen)
    if not dc or not bitmap:
        raise c.WinError(c.get_last_error())
    previous = gdi.SelectObject(dc,bitmap)
    objects = []
    def brush(color):
        value = gdi.CreateSolidBrush(color)
        if not value: raise c.WinError(c.get_last_error())
        objects.append(value)
        return value
    layout = {}
    def text(key, value, preferred, minimum, weight, color):
        left,top,right,bottom = SCENE_REGIONS[key]
        for size in range(preferred,minimum-1,-1):
            font = gdi.CreateFontW(-size,0,0,0,weight,0,0,0,1,0,0,4,0,'Arial')
            if not font: raise c.WinError(c.get_last_error())
            old = gdi.SelectObject(dc,font)
            try:
                def measure(value):
                    extent = w.SIZE()
                    count = len(value.encode('utf-16-le'))//2
                    if not gdi.GetTextExtentPoint32W(dc,value,count,c.byref(extent)):
                        raise c.WinError(c.get_last_error())
                    return extent.cx
                lines = wrap_measured(value,measure,right-left)
                line_height = round(size*1.25)
                if len(lines)*line_height > bottom-top:
                    continue
                gdi.SetTextColor(dc,color)
                for index,line in enumerate(lines):
                    box = w.RECT(left,top+index*line_height,right,top+(index+1)*line_height)
                    if not user.DrawTextW(dc,line,-1,c.byref(box),0x20|0x800):
                        raise c.WinError(c.get_last_error())
                layout[key] = {'region':list(SCENE_REGIONS[key]),'font_size':size,'lines':lines,
                    'bounds':[left,top,left+max(measure(line) for line in lines),top+len(lines)*line_height]}
                return
            finally:
                gdi.SelectObject(dc,old)
                gdi.DeleteObject(font)
        raise ValueError('Texto não cabe integralmente na área segura: '+key)
    try:
        user.FillRect(dc,c.byref(w.RECT(0,0,1080,1920)),brush(0x2a1810))
        user.FillRect(dc,c.byref(w.RECT(*SCENE_REGIONS['accent'])),brush(0xffa485))
        gdi.SetBkMode(dc,1)
        text('label',f"PILOTO LOCAL  /  {section['n']}",28,24,400,0xffa485)
        text('heading',section['heading'],56,28,700,0xffffff)
        text('summary',section['summary'],36,26,400,0xffffff)
        text('disclosure','VOZ SINTÉTICA LOCAL | LICENÇA NÃO VERIFICADA',24,22,400,0xffa485)
        layout['accent'] = {'bounds':list(SCENE_REGIONS['accent'])}
        for item in layout.values():
            for direction in ('esquerda','direita','cima','baixo'):
                for progress in (0,.25,.5,.75,1):
                    x0,y0,x1,y1 = transformed_bounds(item['bounds'],progress,direction)
                    if not (0 <= x0 < x1 <= 1080 and 0 <= y0 < y1 <= 1920):
                        raise ValueError('Conteúdo ultrapassa área segura Ken Burns.')
        path.with_suffix('.layout.json').write_text(json.dumps(layout,ensure_ascii=False,indent=2),encoding='utf-8')
        # Cabeçalho BITMAPINFOHEADER, BGRA top-down; converte para PNG RGB stdlib.
        info = struct.pack('<IiiHHIIiiII',40,1080,-1920,1,32,0,1080*1920*4,0,0,0,0)
        pixels = (c.c_ubyte * (1080*1920*4))()
        gdi.SelectObject(dc,previous)
        if gdi.GetDIBits(dc,bitmap,0,1920,pixels,info,0) != 1920:
            raise c.WinError(c.get_last_error())
        data = bytes(pixels)
        rows = bytearray()
        for y in range(1920):
            rows.append(0)
            row = data[y*4320:(y+1)*4320]
            rgb = bytearray(3240)
            rgb[0::3],rgb[1::3],rgb[2::3] = row[2::4],row[1::4],row[0::4]
            rows.extend(rgb)
        def chunk(kind,value):
            return struct.pack('>I',len(value))+kind+value+struct.pack('>I',zlib.crc32(kind+value))
        path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1080,1920,8,2,0,0,0))+
                         chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b''))
    finally:
        gdi.SelectObject(dc,previous)
        for obj in objects: gdi.DeleteObject(obj)
        gdi.DeleteObject(bitmap)
        gdi.DeleteDC(dc)


def main(input_path):
    global ole
    if sys.platform != 'win32':
        raise ValueError('Windows SAPI local indisponível neste sistema.')
    ole = c.OleDLL('ole32')
    automation = c.WinDLL('oleaut32')
    ole.CoCreateInstance.argtypes = [c.POINTER(GUID),c.c_void_p,c.c_ulong,c.POINTER(GUID),c.POINTER(c.c_void_p)]
    ole.SysAllocString = automation.SysAllocString
    ole.SysAllocString.argtypes,ole.SysAllocString.restype = [w.LPCWSTR],c.c_void_p
    ole.VariantClear = automation.VariantClear
    ole.VariantClear.argtypes = [c.POINTER(Variant)]
    check(ole.CoInitializeEx(None,2))
    voice = tokens = token = stream = fmt = None
    try:
        request = json.loads(Path(input_path).read_text(encoding='utf-8'))
        folder = Path(request['folder'])
        voice = Dispatch.create('96749377-3391-11d2-9ee3-00c04f797396')
        tokens = voice.invoke('GetVoices','Language=416','')
        if tokens.invoke('Count',flags=2) < 1:
            raise ValueError('Voz offline pt-BR não instalada.')
        token = tokens.invoke('Item',0)
        name = token.invoke('GetDescription',0)
        language = token.invoke('GetAttribute','Language')
        if '416' not in language.lower().split(';'):
            raise ValueError('Voz não é pt-BR.')
        voice.invoke('Voice',token,flags=8)
        for section in request['sections']:
            stream = Dispatch.create('947812b3-2ae1-4644-ba86-9e90ded7ec91')
            fmt = stream.invoke('Format',flags=2)
            fmt.invoke('Type',22,flags=4)  # SAFT22kHz16BitMono
            fmt.close(); fmt = None
            stream.invoke('Open',str(folder/f"section-{section['n']}.wav"),3,False)
            try:
                voice.invoke('AudioOutputStream',stream,flags=8)
                voice.invoke('Speak',section['text'],16)  # texto BSTR; nunca código ou SSML
            finally:
                stream.invoke('Close')
                stream.close(); stream = None
            scene(folder/f"scene-{section['n']}.png",section)
        (folder/'voice.json').write_text(json.dumps({'voice':name,'culture':'pt-BR'},ensure_ascii=False),encoding='utf-8')
    finally:
        for value in (fmt,stream,token,tokens,voice):
            if value is not None: value.close()
        ole.CoUninitialize()


if __name__ == '__main__':
    main(sys.argv[1])
