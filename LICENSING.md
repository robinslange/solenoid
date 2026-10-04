# Licensing

This repository is split by license. Code that runs the Solenoid server is source-available under FSL-1.1-ALv2. Client code is MIT. There is no single license at the root; each directory carries its own `LICENSE`, and this file maps them. The licensor is Robin Lange, trading as omit.

| Path | License | Why |
|---|---|---|
| `worker/` | FSL-1.1-ALv2 | The server |
| `testing/` | FSL-1.1-ALv2 | `@solenoid.systems/testing` bundles the server's request handler and ledger |
| `e2e/` | FSL-1.1-ALv2 | It drives the server, and holds the proof tests, the race recorder and the canary |
| `docs/superpowers/` | FSL-1.1-ALv2 | The design specs and plans contain the server's source |
| `sdk/` | MIT | Client |
| `cli/` | MIT | Client |
| `mcp/` | MIT | Client |
| `contract/` | MIT | Client-side scenarios written against the SDK |
| `site/` | MIT | solenoid.systems |
| `docs/` | MIT | Documentation, except `docs/superpowers/` |
| `site/public/fonts/` | SIL Open Font License 1.1 | Archivo and JetBrains Mono; the license texts ship beside the fonts |
| `scripts/`, `.github/` and the files at the root | MIT | Repository tooling and documentation |

## FSL-1.1-ALv2, in its own terms

You may use, copy, change and redistribute the server for any purpose except a Competing Use. A Competing Use means making the software available to others in a commercial product or service that substitutes for it, substitutes for any other product or service the licensor offers using it that exists when the software is made available, or offers the same or substantially similar functionality. Permitted Purposes are internal use and access, non-commercial education, non-commercial research, and professional services provided to a licensee using the software under this license. Each version becomes available under the Apache License 2.0 on the second anniversary of its release. The full text is in each FSL directory's `LICENSE`, from the [FSL-1.1-ALv2 template](https://fsl.software/FSL-1.1-ALv2.template.md).
