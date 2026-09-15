# Audio Tag Editor

This official LX-M Music plugin uses the project's existing **node-id3 0.2.9**
dependency to decode and encode ID3 frames. The plugin preserves untouched ID3
frames and FLAC metadata blocks and replaces the original file only after its
temporary replacement has been written and validated.

- node-id3: https://github.com/Zazama/node-id3 — MIT
- iconv-lite: https://github.com/ashtuchkin/iconv-lite — MIT
- safer-buffer: https://github.com/ChALkeR/safer-buffer — MIT

The corresponding MIT license texts are included in `licenses/` in the plugin
package. These dependencies are bundled in the plugin; no additional runtime
installation is required.

Supported files: MP3 with ordinary ID3v2.3/ID3v2.4 tags (or no ID3v2 tag), and
native FLAC. Extended, globally unsynchronised, compressed or older ID3 tags
are rejected before writing. This version edits text fields; artwork, lyrics,
ratings and other fields are retained.
