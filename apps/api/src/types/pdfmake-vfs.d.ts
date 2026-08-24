/**
 * pdfmake ships its Roboto fonts as a base64 virtual file system with no types.
 * The shape has moved between releases, so both layouts are declared and the
 * renderer picks whichever is present.
 */
declare module 'pdfmake/build/vfs_fonts' {
  const vfs: {
    pdfMake?: { vfs: Record<string, string> };
    vfs?: Record<string, string>;
  } & Record<string, unknown>;
  export default vfs;
}
