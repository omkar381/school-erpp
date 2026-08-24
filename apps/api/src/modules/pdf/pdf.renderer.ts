import { Injectable } from '@nestjs/common';
import PdfPrinter from 'pdfmake';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import vfsModule from 'pdfmake/build/vfs_fonts';

/** pdfmake has moved the VFS between a nested and a top-level export. */
function resolveVfs(): Record<string, string> {
  return (
    vfsModule.pdfMake?.vfs ??
    vfsModule.vfs ??
    (vfsModule as unknown as Record<string, string>)
  );
}

/**
 * Renders pdfmake document definitions to Buffers.
 *
 * Roboto is embedded from pdfmake's virtual file system rather than read off
 * disk, so the container needs no font packages, and — unlike the built-in
 * Helvetica — it actually carries the rupee sign that every invoice in this
 * product prints.
 */
@Injectable()
export class PdfRenderer {
  private readonly printer: PdfPrinter;

  constructor() {
    const vfs = resolveVfs();
    const font = (name: string): Buffer => Buffer.from(vfs[name], 'base64');

    this.printer = new PdfPrinter({
      Roboto: {
        normal: font('Roboto-Regular.ttf'),
        bold: font('Roboto-Medium.ttf'),
        italics: font('Roboto-Italic.ttf'),
        bolditalics: font('Roboto-MediumItalic.ttf'),
      },
    });
  }

  render(definition: TDocumentDefinitions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const document = this.printer.createPdfKitDocument({
          ...definition,
          defaultStyle: { font: 'Roboto', fontSize: 9, ...definition.defaultStyle },
        });

        const chunks: Buffer[] = [];
        document.on('data', (chunk: Buffer) => chunks.push(chunk));
        document.on('error', reject);
        document.on('end', () => resolve(Buffer.concat(chunks)));
        document.end();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
