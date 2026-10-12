<?php
// Минимальный генератор .xlsx без внешних библиотек — только встроенный ZipArchive.
// Поддерживает: несколько листов, текстовые/числовые ячейки, жирную шапку, ширину колонок,
// RTL-лист (для иврита/арабского) и встраивание PNG-картинок (например, графиков из GD).
// Не поддерживает: формулы, сложное форматирование, "настоящие" интерактивные Excel-диаграммы —
// графики вставляются как картинки (см. addImage).
//
// Использование:
//   $wb = new XlsxWriter();
//   $sheet = $wb->addSheet('Регламент', [25, 14, 14], $rightToLeft = false);
//   $sheet->addRow(['№', 'Название', 'Статус'], true); // true = жирным (шапка)
//   $sheet->addRow([1, 'Дизельный насос', 'done']);
//   $sheet->addImage($pngBinaryData, $row = 5, $col = 0, $widthPx = 600, $heightPx = 260);
//   $wb->save('/path/to/file.xlsx');

class XlsxSheet
{
    public string $name;
    public array $rows = [];
    public array $colWidths = [];
    public bool $rightToLeft = false;
    public array $images = []; // ['png'=>string, 'row'=>int, 'col'=>int, 'wPx'=>int, 'hPx'=>int]

    public function __construct(string $name, array $colWidths = [], bool $rightToLeft = false)
    {
        $this->name = $name;
        $this->colWidths = $colWidths;
        $this->rightToLeft = $rightToLeft;
    }

    public function addRow(array $cells, bool $bold = false): void
    {
        $this->rows[] = ['cells' => $cells, 'bold' => $bold];
    }

    // $pngData — бинарные данные PNG (как возвращает imagepng() в буфер через ob_start/ob_get_clean).
    // $row/$col — 0-based ячейка, от которой начинается картинка (верхний левый угол).
    public function addImage(string $pngData, int $row, int $col, int $widthPx, int $heightPx): void
    {
        $this->images[] = ['png' => $pngData, 'row' => $row, 'col' => $col, 'wPx' => $widthPx, 'hPx' => $heightPx];
    }
}

class XlsxWriter
{
    private const EMU_PER_PX = 9525;

    /** @var XlsxSheet[] */
    private array $sheets = [];
    private array $sharedStrings = [];
    private array $sharedStringsIndex = [];

    public function addSheet(string $name, array $colWidths = [], bool $rightToLeft = false): XlsxSheet
    {
        $safeName = substr(preg_replace('/[\\\\\\/\\?\\*\\[\\]:]/', ' ', $name), 0, 31);
        $sheet = new XlsxSheet($safeName ?: 'Sheet', $colWidths, $rightToLeft);
        $this->sheets[] = $sheet;
        return $sheet;
    }

    private function sharedStringId(string $s): int
    {
        if (isset($this->sharedStringsIndex[$s])) return $this->sharedStringsIndex[$s];
        $id = count($this->sharedStrings);
        $this->sharedStrings[] = $s;
        $this->sharedStringsIndex[$s] = $id;
        return $id;
    }

    private static function colLetter(int $index): string
    {
        $letter = '';
        $index++;
        while ($index > 0) {
            $rem = ($index - 1) % 26;
            $letter = chr(65 + $rem) . $letter;
            $index = intdiv($index - 1, 26);
        }
        return $letter;
    }

    private static function xmlEscape(string $s): string
    {
        return htmlspecialchars($s, ENT_QUOTES | ENT_XML1, 'UTF-8');
    }

    public function save(string $path): bool
    {
        foreach ($this->sheets as $sheet) {
            foreach ($sheet->rows as $row) {
                foreach ($row['cells'] as $cell) {
                    if (is_string($cell)) $this->sharedStringId($cell);
                }
            }
        }

        $zip = new ZipArchive();
        if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) return false;

        $zip->addEmptyDir('_rels');
        $zip->addEmptyDir('xl');
        $zip->addEmptyDir('xl/_rels');
        $zip->addEmptyDir('xl/worksheets');
        $hasAnyImages = false;
        foreach ($this->sheets as $sheet) { if (!empty($sheet->images)) $hasAnyImages = true; }
        if ($hasAnyImages) {
            $zip->addEmptyDir('xl/worksheets/_rels');
            $zip->addEmptyDir('xl/drawings');
            $zip->addEmptyDir('xl/drawings/_rels');
            $zip->addEmptyDir('xl/media');
        }

        $zip->addFromString('[Content_Types].xml', $this->contentTypesXml());
        $zip->addFromString('_rels/.rels', $this->rootRelsXml());
        $zip->addFromString('xl/workbook.xml', $this->workbookXml());
        $zip->addFromString('xl/_rels/workbook.xml.rels', $this->workbookRelsXml());
        $zip->addFromString('xl/styles.xml', $this->stylesXml());
        $zip->addFromString('xl/sharedStrings.xml', $this->sharedStringsXml());

        $globalImgCounter = 0;
        foreach ($this->sheets as $i => $sheet) {
            $n = $i + 1;
            $zip->addFromString('xl/worksheets/sheet' . $n . '.xml', $this->sheetXml($sheet));
            if (!empty($sheet->images)) {
                $imageFilenames = [];
                foreach ($sheet->images as $img) {
                    $globalImgCounter++;
                    $fname = 'image' . $globalImgCounter . '.png';
                    $zip->addFromString('xl/media/' . $fname, $img['png']);
                    $imageFilenames[] = $fname;
                }
                $zip->addFromString('xl/drawings/drawing' . $n . '.xml', $this->drawingXml($sheet));
                $zip->addFromString('xl/drawings/_rels/drawing' . $n . '.xml.rels', $this->drawingRelsXml($imageFilenames));
                $zip->addFromString('xl/worksheets/_rels/sheet' . $n . '.xml.rels', $this->sheetRelsXml('drawing' . $n . '.xml'));
            }
        }

        return $zip->close();
    }

    private function contentTypesXml(): string
    {
        $sheetEntries = '';
        $drawingEntries = '';
        $hasImages = false;
        foreach ($this->sheets as $i => $sheet) {
            $n = $i + 1;
            $sheetEntries .= "<Override PartName=\"/xl/worksheets/sheet$n.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>";
            if (!empty($sheet->images)) {
                $hasImages = true;
                $drawingEntries .= "<Override PartName=\"/xl/drawings/drawing$n.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.drawing+xml\"/>";
            }
        }
        $pngDefault = $hasImages ? '<Default Extension="png" ContentType="image/png"/>' : '';
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            . '<Default Extension="xml" ContentType="application/xml"/>'
            . $pngDefault
            . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            . '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
            . $sheetEntries . $drawingEntries
            . '</Types>';
    }

    private function rootRelsXml(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            . '</Relationships>';
    }

    private function workbookXml(): string
    {
        $sheetsXml = '';
        foreach ($this->sheets as $i => $sheet) {
            $n = $i + 1;
            $sheetsXml .= '<sheet name="' . self::xmlEscape($sheet->name) . '" sheetId="' . $n . '" r:id="rId' . $n . '"/>';
        }
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            . '<sheets>' . $sheetsXml . '</sheets>'
            . '</workbook>';
    }

    private function workbookRelsXml(): string
    {
        $rels = '';
        $sheetCount = count($this->sheets);
        foreach ($this->sheets as $i => $sheet) {
            $n = $i + 1;
            $rels .= '<Relationship Id="rId' . $n . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . $n . '.xml"/>';
        }
        $stylesId = $sheetCount + 1;
        $sstId = $sheetCount + 2;
        $rels .= '<Relationship Id="rId' . $stylesId . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
        $rels .= '<Relationship Id="rId' . $sstId . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>';
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' . $rels . '</Relationships>';
    }

    private function stylesXml(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            . '<fonts count="2">'
            . '<font><sz val="10"/><name val="Calibri"/></font>'
            . '<font><sz val="10"/><name val="Calibri"/><b/></font>'
            . '</fonts>'
            . '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
            . '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            . '<cellXfs count="2">'
            . '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            . '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
            . '</cellXfs>'
            . '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            . '</styleSheet>';
    }

    private function sharedStringsXml(): string
    {
        $items = '';
        foreach ($this->sharedStrings as $s) {
            $items .= '<si><t xml:space="preserve">' . self::xmlEscape($s) . '</t></si>';
        }
        $count = count($this->sharedStrings);
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' . $count . '" uniqueCount="' . $count . '">'
            . $items . '</sst>';
    }

    private function sheetXml(XlsxSheet $sheet): string
    {
        $cols = '';
        if (!empty($sheet->colWidths)) {
            $cols = '<cols>';
            foreach ($sheet->colWidths as $i => $w) {
                $cols .= '<col min="' . ($i + 1) . '" max="' . ($i + 1) . '" width="' . (float)$w . '" customWidth="1"/>';
            }
            $cols .= '</cols>';
        }

        $sheetViews = '<sheetViews><sheetView rightToLeft="' . ($sheet->rightToLeft ? 1 : 0) . '" workbookViewId="0"/></sheetViews>';

        $rowsXml = '';
        foreach ($sheet->rows as $rowIndex => $row) {
            $r = $rowIndex + 1;
            $styleId = $row['bold'] ? 1 : 0;
            $cellsXml = '';
            foreach ($row['cells'] as $colIndex => $cell) {
                $ref = self::colLetter($colIndex) . $r;
                if ($cell === null || $cell === '') {
                    $cellsXml .= '<c r="' . $ref . '" s="' . $styleId . '"/>';
                } elseif (is_int($cell) || is_float($cell)) {
                    $cellsXml .= '<c r="' . $ref . '" s="' . $styleId . '"><v>' . $cell . '</v></c>';
                } else {
                    $sid = $this->sharedStringId((string)$cell);
                    $cellsXml .= '<c r="' . $ref . '" s="' . $styleId . '" t="s"><v>' . $sid . '</v></c>';
                }
            }
            $rowsXml .= '<row r="' . $r . '">' . $cellsXml . '</row>';
        }

        $drawingRef = !empty($sheet->images) ? '<drawing r:id="rId1"/>' : '';

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            . $sheetViews
            . $cols
            . '<sheetData>' . $rowsXml . '</sheetData>'
            . $drawingRef
            . '</worksheet>';
    }

    private function sheetRelsXml(string $drawingFilename): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/' . $drawingFilename . '"/>'
            . '</Relationships>';
    }

    private function drawingXml(XlsxSheet $sheet): string
    {
        $anchors = '';
        foreach ($sheet->images as $i => $img) {
            $cx = $img['wPx'] * self::EMU_PER_PX;
            $cy = $img['hPx'] * self::EMU_PER_PX;
            $rid = $i + 1;
            $picId = $i + 2;
            $anchors .= '<xdr:oneCellAnchor>'
                . '<xdr:from><xdr:col>' . $img['col'] . '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' . $img['row'] . '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>'
                . '<xdr:ext cx="' . $cx . '" cy="' . $cy . '"/>'
                . '<xdr:pic>'
                . '<xdr:nvPicPr><xdr:cNvPr id="' . $picId . '" name="Chart' . ($i + 1) . '"/><xdr:cNvPicPr/></xdr:nvPicPr>'
                . '<xdr:blipFill>'
                . '<a:blip r:embed="rId' . $rid . '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>'
                . '<a:stretch><a:fillRect/></a:stretch>'
                . '</xdr:blipFill>'
                . '<xdr:spPr>'
                . '<a:xfrm><a:off x="0" y="0"/><a:ext cx="' . $cx . '" cy="' . $cy . '"/></a:xfrm>'
                . '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
                . '</xdr:spPr>'
                . '</xdr:pic>'
                . '<xdr:clientData/>'
                . '</xdr:oneCellAnchor>';
        }
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            . $anchors . '</xdr:wsDr>';
    }

    private function drawingRelsXml(array $imageFilenames): string
    {
        $rels = '';
        foreach ($imageFilenames as $i => $fname) {
            $rels .= '<Relationship Id="rId' . ($i + 1) . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/' . $fname . '"/>';
        }
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' . $rels . '</Relationships>';
    }
}