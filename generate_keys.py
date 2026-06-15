#!/usr/bin/env python3
"""
Run this ONCE to generate VAPID keys for push notifications.
Output the keys and add them to your Render environment variables.
"""
from py_vapid import Vapid

v = Vapid()
v.generate_keys()

private_key = v.private_pem().decode()
public_key  = v.public_key.public_bytes(
    __import__('cryptography').hazmat.primitives.serialization.Encoding.X962,
    __import__('cryptography').hazmat.primitives.serialization.PublicFormat.UncompressedPoint
)

import base64
public_b64 = base64.urlsafe_b64encode(public_key).rstrip(b'=').decode()

print("=" * 60)
print("VAPID KEYS — dodaj u Render environment variables:")
print("=" * 60)
print(f"\nVAPID_PUBLIC_KEY={public_b64}")
print(f"\nVAPID_PRIVATE_KEY={private_key.strip()}")
print("\n" + "=" * 60)
print("OSTALE PROMENLJIVE:")
print("AVIATIONSTACK_KEY=tvoj_api_kljuc")
print("VAPID_EMAIL=mailto:tvoj@email.com")
print("=" * 60)
