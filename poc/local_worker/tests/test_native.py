"""Native local helper checks."""

import ctypes
import contextlib
import io
import os
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import unittest
import zipfile


@contextlib.contextmanager
def socket_pair():
    receiver, sender = socket.socketpair()
    try:
        yield receiver, sender
    finally:
        receiver.close()
        sender.close()


class Connection(ctypes.Structure):
    _fields_ = [("sock", ctypes.c_int), ("connected", ctypes.c_int)]


@unittest.skipUnless(sys.platform.startswith("linux"), "Linux native check")
class NativeChecks(unittest.TestCase):
    # Function Native Setup
    @classmethod
    def setUpClass(cls):
        compiler = shutil.which("cc")
        if not compiler:
            raise unittest.SkipTest("C compiler unavailable")
        cls.directory = tempfile.TemporaryDirectory(prefix="garlic-local-native-")
        cls.addClassCleanup(cls.directory.cleanup)
        cls.work = Path(cls.directory.name)
        source = Path(__file__).resolve().parents[1] / "src"
        library = cls.work / "local-checks.so"
        stub = cls.work / "stubs.c"
        stub.write_text(
            "int http_tcp_connect(const char *host, int port) { "
            "(void)host; (void)port; return -1; }\n"
            "void garlic_log(const char *message, ...) { (void)message; }\n"
        )
        subprocess.run(
            [compiler, "-shared", "-fPIC", "-std=c11", "-D_DEFAULT_SOURCE",
             "-Wall", "-Wextra", "-Werror", "-I", str(source), "-I", str(source / "ps5"),
             str(source / "local_validation.c"), str(source / "ps5/chives.c"),
             str(source / "tcp.c"), str(stub), "-o", str(library)],
            check=True, capture_output=True, text=True,
        )
        cls.native = ctypes.CDLL(str(library))
        cls.native.local_validate_zip.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
        cls.native.local_validate_zip.restype = ctypes.c_int
        cls.native.tcp_recv_msg.argtypes = [ctypes.POINTER(Connection), ctypes.c_void_p, ctypes.c_int]
        cls.native.tcp_recv_msg.restype = ctypes.c_int
        cls.native.tcp_send_msg.argtypes = [ctypes.POINTER(Connection), ctypes.c_char_p]
        cls.native.tcp_send_msg.restype = ctypes.c_int
        cls.native.tcp_recv_to_file.argtypes = [ctypes.POINTER(Connection), ctypes.c_int, ctypes.c_int64]
        cls.native.tcp_recv_to_file.restype = ctypes.c_int
        cls.native.tcp_send_file.argtypes = [ctypes.POINTER(Connection), ctypes.c_char_p]
        cls.native.tcp_send_file.restype = ctypes.c_int

    # Function Archive Building
    def archive(self, name="data/save.dat", compression=zipfile.ZIP_STORED):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=compression) as archive:
            archive.writestr(name, b"save-data\x00\xff" * 13)
            archive.writestr("sce_sys/param.sfo", b"PSF-test")
        return output.getvalue()

    # Function Archive Checking
    def validate(self, data):
        archive = self.work / "input.zip"
        archive.write_bytes(data)
        return self.native.local_validate_zip(os.fsencode(archive), b"/data/garlic/work/localjob")

    def test_stored_zip_is_accepted(self):
        self.assertEqual(self.validate(self.archive()), 0)

    def test_path_traversal_is_rejected(self):
        for name in ["../save.dat", "data/../../save.dat", "/save.dat", "data\\save.dat", "C:/save.dat"]:
            with self.subTest(name=name):
                self.assertEqual(self.validate(self.archive(name)), -1)

    def test_compressed_zip_is_rejected(self):
        self.assertEqual(self.validate(self.archive(compression=zipfile.ZIP_DEFLATED)), -1)

    def test_data_descriptor_zip_is_rejected(self):
        data = bytearray(self.archive())
        struct.pack_into("<H", data, 6, struct.unpack_from("<H", data, 6)[0] | 8)
        self.assertEqual(self.validate(data), -1)

    def test_encrypted_zip_is_rejected(self):
        data = bytearray(self.archive())
        struct.pack_into("<H", data, 6, struct.unpack_from("<H", data, 6)[0] | 1)
        self.assertEqual(self.validate(data), -1)

    def test_truncated_headers_and_payload_are_rejected(self):
        data = self.archive()
        name_size, extra_size = struct.unpack_from("<HH", data, 26)
        body = 30 + name_size + extra_size
        for length in [0, 3, 22, 29, body - 1, body + 2]:
            with self.subTest(length=length):
                self.assertEqual(self.validate(data[:length]), -1)

    def test_truncated_central_directory_is_rejected(self):
        data = self.archive()
        central = data.index(b"PK\x01\x02")
        for length in [central, central + 4, len(data) - 1, len(data) - 22]:
            with self.subTest(length=length):
                self.assertEqual(self.validate(data[:length]), -1)

    def test_empty_zip_is_rejected(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w"):
            pass
        self.assertEqual(self.validate(output.getvalue()), -1)

    def test_normal_length_prefixed_message_is_received(self):
        with socket_pair() as (receiver, sender):
            sender.sendall(struct.pack("!I", 18) + b'{"type":"hello"}xx')
            buffer = ctypes.create_string_buffer(64)
            connection = Connection(receiver.fileno(), 1)
            self.assertEqual(self.native.tcp_recv_msg(ctypes.byref(connection), buffer, 64), 18)
            self.assertEqual(buffer.value, b'{"type":"hello"}xx')

    def test_invalid_message_lengths_are_rejected(self):
        for length in [0, 64, 65, 0xFFFFFFFF]:
            with self.subTest(length=length):
                with socket_pair() as (receiver, sender):
                    sender.sendall(struct.pack("!I", length))
                    buffer = ctypes.create_string_buffer(64)
                    connection = Connection(receiver.fileno(), 1)
                    self.assertEqual(self.native.tcp_recv_msg(ctypes.byref(connection), buffer, 64), -1)

    def test_truncated_message_is_rejected(self):
        for data in [b"\x00\x00", struct.pack("!I", 12) + b"abc"]:
            with self.subTest(data=data):
                with socket_pair() as (receiver, sender):
                    sender.sendall(data)
                    sender.shutdown(socket.SHUT_WR)
                    buffer = ctypes.create_string_buffer(64)
                    connection = Connection(receiver.fileno(), 1)
                    self.assertEqual(self.native.tcp_recv_msg(ctypes.byref(connection), buffer, 64), -1)

    def test_outbound_message_uses_big_endian_length(self):
        data = b'{"type":"result_ok"}'
        with socket_pair() as (receiver, sender):
            connection = Connection(sender.fileno(), 1)
            self.assertEqual(self.native.tcp_send_msg(ctypes.byref(connection), data), 0)
            self.assertEqual(receiver.recv(4 + len(data)), struct.pack("!I", len(data)) + data)

    def test_raw_input_bytes_preserve_next_frame(self):
        payload = bytes(range(256)) * 300
        follow = b'{"type":"done"}'
        target = self.work / "received.bin"
        with socket_pair() as (receiver, sender):
            writer = threading.Thread(target=sender.sendall, args=(payload + struct.pack("!I", len(follow)) + follow,))
            writer.start()
            connection = Connection(receiver.fileno(), 1)
            with target.open("wb") as output:
                self.assertEqual(self.native.tcp_recv_to_file(ctypes.byref(connection), output.fileno(), len(payload)), 0)
            buffer = ctypes.create_string_buffer(64)
            self.assertEqual(self.native.tcp_recv_msg(ctypes.byref(connection), buffer, 64), len(follow))
            self.assertEqual(buffer.value, follow)
            writer.join(timeout=5)
            self.assertFalse(writer.is_alive())
        self.assertEqual(target.read_bytes(), payload)

    def test_raw_output_bytes_are_preserved(self):
        payload = bytes(range(256)) * 300
        source = self.work / "send.bin"
        source.write_bytes(payload)
        result = []
        with socket_pair() as (receiver, sender):
            connection = Connection(sender.fileno(), 1)
            writer = threading.Thread(target=lambda: result.append(self.native.tcp_send_file(ctypes.byref(connection), os.fsencode(source))))
            writer.start()
            chunks = []
            remaining = len(payload)
            while remaining:
                chunk = receiver.recv(remaining)
                self.assertTrue(chunk)
                chunks.append(chunk)
                remaining -= len(chunk)
            writer.join(timeout=5)
            self.assertFalse(writer.is_alive())
        self.assertEqual(result, [0])
        self.assertEqual(b"".join(chunks), payload)


if __name__ == "__main__":
    unittest.main()
