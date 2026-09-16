# Android signing custody

Release signing is injected by GitHub Actions from these encrypted repository secrets:

- `ANDROID_SIGNING_KEYSTORE_BASE64`
- `ANDROID_SIGNING_STORE_PASSWORD`
- `ANDROID_SIGNING_KEY_ALIAS`
- `ANDROID_SIGNING_KEY_PASSWORD`

The expected public certificate SHA-256 is
`B8:E4:BC:FC:E5:94:FB:84:C1:28:0B:A7:C2:60:A7:67:49:2D:74:7C:A8:6C:A0:DD:51:A5:77:CC:E1:87:0D:04`.
The workflow rejects any APK signed by a different certificate. Private keys and passwords
must never be added to this directory or written to build logs.

## Rotation policy

The current certificate is already installed on exhibition clients. Replacing it directly
would prevent in-place upgrades on part of the Android 7+ fleet. Routine rotation therefore
means rotating GitHub access and secret custody while retaining this signing certificate.

If the private key is suspected compromised, freeze APK publication, inventory every device,
export required client configuration, and schedule a managed uninstall/reinstall with a new
certificate. A future Play-managed or Android signing-lineage migration may be used only after
the minimum device OS and update path have been verified on the real fleet.
