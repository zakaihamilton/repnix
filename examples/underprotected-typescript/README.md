# Under-protected TypeScript demo

This intentionally small project powers RepNix's launch demo. It has TypeScript and a lockfile but omits the other repository-health providers that `repnix audit` recommends.

Run the demo from this directory with the packaged RepNix CLI:

```bash
npx repnix audit
npx repnix setup --plan
```
