# Hamd Foods ERP Windows installer source

This directory contains the Inno Setup definition and installed PowerShell utilities. Generated payloads, prerequisite binaries, signing material, and installer executables are intentionally ignored.

Release engineering commands are documented in `docs/operations/windows-installer.md`. `scripts/installer.ts` pins Node 24.11.1 and verifies its official SHA-256 before staging it. An optional official PostgreSQL 16 installer can be supplied only with an operator-provided trusted checksum; no prerequisite is downloaded or committed automatically.

The normal build produces a clearly labelled `DEVELOPMENT-UNSIGNED` executable unless `HAMDFOODS_INNO_SIGNTOOL_NAME` names a preconfigured Inno Setup signing tool. A signing certificate or private key must never be stored in this repository.
