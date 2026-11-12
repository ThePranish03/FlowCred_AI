from app.security import hash_password, verify_password

def test_password_hash_is_salted_and_verified():
    first = hash_password("secure-demo-password")
    second = hash_password("secure-demo-password")
    assert first != second
    assert verify_password("secure-demo-password", first)
    assert not verify_password("wrong-password", first)
