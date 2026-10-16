"""crypto.py — 上游注册/登录所需的 RSA 密码加密（逆向自站点硬编码公钥）。

前端使用 JSEncrypt：RSA-2048 / PKCS#1 v1.5 / Base64 输出。
"""
from __future__ import annotations

import base64
import re

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding

# 逆向自 index-7NIgzoXo.js（B 函数）
UPSTREAM_PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAn8Ue/SM/Jsn9HqDXuj2l
ILgccwtZDnEM47oKi/Vo5c/UHmJNj+ypRtBlHy2qgUnW2xFYFJ9wvODe0wsCSq3F
s7JGJGAUQixKTvdhOa8PvtnG8qmtmCx9Ib0Tei4i7Aa7h2xyLKkG07ylKGyQhIze
5efUXdAy1jCGgyHC/5LIwIkiF1/LjrOCPe1OEAMuPNunZ96nm1thahiqp6oHD4OZ
3gmRNE+GSwWNpsbCbbRw0dSS6Crhrr229h3myDs5wzKvXMaFtelFVY8bQJKZhipi
FFvz4AiBL4vWrETEe9Gcgit7MCpYswzBpTtympuseEZMBNxlIyFNteEggEt4Wyup
PwIDAQAB
-----END PUBLIC KEY-----"""

_pub = serialization.load_pem_public_key(UPSTREAM_PUBLIC_KEY_PEM.encode())
KEY_SIZE = _pub.key_size  # 2048


def encrypt_password(password: str) -> str:
    """等价于前端 new JSEncrypt().setPublicKey(pem).encrypt(password)。"""
    ct = _pub.encrypt(password.encode("utf-8"), padding.PKCS1v15())
    return base64.b64encode(ct).decode("ascii")


def password_ok(password: str) -> bool:
    """前端同款强度校验：长度≥8 且含数字、含字母、含大写或符号。"""
    if len(password) < 8:
        return False
    if not re.search(r"\d", password):
        return False
    if not re.search(r"[a-zA-Z]", password):
        return False
    if not re.search(r"[A-Z\W_]", password):
        return False
    return True


if __name__ == "__main__":
    enc = encrypt_password("Abcd1234!")
    print("key_size:", KEY_SIZE)
    print("cipher_len:", len(enc))
    print("sample:", enc[:48] + "...")
    print("strength ok:", password_ok("Abcd1234!"))
