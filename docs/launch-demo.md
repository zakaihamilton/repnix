# Maintaining the launch demo

This demo must show RepNix on [`examples/underprotected-typescript`](../examples/underprotected-typescript), an intentionally under-protected project. Do not record an existing repository or include credentials, private paths, or unrelated shell history.

From a temporary copy of the demo project, install the published package and run these commands in a terminal no wider than 110 columns:

```bash
npm install --save-dev repnix
npx repnix audit
npx repnix setup --plan
```

The GIF should visibly establish that the audit identifies useful gaps and that `setup --plan` previews changes without applying them. Keep it below 8 MB and replace the README image only after checking it locally and on GitHub.

The checked-in frames preserve the reviewed terminal content. Regenerate the GIF after changing them:

```bash
magick -delay 1000 -loop 0 docs/launch-demo-frames/*.svg docs/repnix-launch-demo.gif
```
