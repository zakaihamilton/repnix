---
"repnix": major
---

Remove the external provider-plugin API. RepNix now loads only built-in providers; consumers importing `repnix/provider-sdk` or publishing `repnix-provider-*` integrations must remove those integrations.
