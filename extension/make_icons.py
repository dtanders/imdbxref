import struct, zlib, os

def make_png(size, r, g, b):
    def chunk(name, data):
        c = struct.pack('>I', len(data)) + name + data
        return c + struct.pack('>I', zlib.crc32(name + data) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    raw = b''.join(b'\x00' + bytes([r, g, b] * size) for _ in range(size))
    idat = zlib.compress(raw)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', idat)
            + chunk(b'IEND', b''))

os.makedirs('extension/icons', exist_ok=True)
for size in [16, 48, 128]:
    with open(f'extension/icons/icon{size}.png', 'wb') as f:
        f.write(make_png(size, 245, 197, 24))  # IMDb gold #f5c518
print('Icons generated.')
