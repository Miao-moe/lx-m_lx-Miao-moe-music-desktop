# Portable QRC decoder

`constants.ts` and `custom_des.ts` are the MIT-licensed DES primitives from
[qrc-decoder 1.0.2](https://github.com/apoint123/qrc-decoder), with formatting adapted
to this repository. The original license is retained here and in `licenses/`.

The application wrapper replaces unbounded decompression with Node zlib's 8 MiB
output limit, validates the input and yields between decoding batches. It no
longer needs an Electron ABI-specific native QRC module. Reference vectors were
checked against the previous native decoder and are covered by the Electron
security regression.
