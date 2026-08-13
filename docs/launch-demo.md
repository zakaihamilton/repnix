# Maintaining the launch demo

This demo must show RepNix on [`examples/underprotected-typescript`](../examples/underprotected-typescript), an intentionally under-protected project. Do not record an existing repository or include credentials, private paths, or unrelated shell history.

From a temporary copy of the demo project, install the published package and run these commands in a terminal no wider than 110 columns:

```bash
npm install --save-dev repnix
npx repnix audit
npx repnix setup --plan
npx repnix setup
npm run health
npx repnix check --details
```

Use `setup --plan` for the read-only preview. For a complete local walkthrough, review and confirm `setup`, then let the health check run and inspect the resulting `check --details` output. The checked-in GIF currently focuses on the read-only audit and plan; extend its frames if you want the recording to show the applied setup and verified health result too. Do not imply that planning alone installs or runs providers. Keep it below 8 MB and replace the README image only after checking it locally and on GitHub.

The checked-in frames preserve the reviewed terminal content. Regenerate the GIF after changing them:

```bash
magick -delay 1000 -loop 0 docs/launch-demo-frames/*.svg docs/repnix-launch-demo.gif
```
