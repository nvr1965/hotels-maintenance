<?php
// Маленький генератор .xlsx с НАСТОЯЩИМИ диаграммами Excel (линии и столбики), без библиотек — только ZipArchive.
// Используется выгрузкой счётчиков (export_meter_excel.php). Старый xlsx_writer.php (картинки GD) не трогаем.
//
//   $wb = new XlsxChartBook();
//   $s = $wb->sheet('Показания', [12, 14], false);
//   $s->row([['Дата', 'head'], ['Вода', 'head']]);          // ячейка: значение или [значение, стиль]
//   $s->row([[46300, 'date'], 33620.5]);
//   $s->freezeRows = 1;
//   $g = $wb->sheet('Графики');
//   $g->chart(['type' => 'line', 'title' => 'Вода', 'data' => $s, 'cat' => [2, 0, 40, 0], 'val' => [2, 1, 40, 1],
//              'color' => '844128', 'at' => [0, 0], 'size' => [9, 18]]);
//   $wb->save('/tmp/x.xlsx');
//
// Стили ячеек: 'text', 'head' (жирный на песочном фоне), 'title' (крупный жирный), 'date' (дд.мм.гггг),
// 'num' (число с 2 знаками), 'int' (целое), 'muted' (серый текст), 'headdate' (шапка-дата дд.мм), 'label' (жирный текст).

class XlsxChartSheet
{
    public string $name;
    public array $rows = [];
    public array $widths;
    public bool $rtl;
    public int $freezeRows = 0;
    public array $charts = [];
    public array $merges = [];
    public bool $fitWidth = false; // печать: альбомная, вся ширина листа на одной странице

    public function __construct(string $name, array $widths, bool $rtl)
    {
        $this->name = $name;
        $this->widths = $widths;
        $this->rtl = $rtl;
    }

    // Возвращает номер строки (0-based), куда легла запись
    public function row(array $cells): int
    {
        $this->rows[] = $cells;
        return count($this->rows) - 1;
    }

    // Диаграмма: type line|column, data — лист с данными, cat/val — [строка1, колонка1, строка2, колонка2] (0-based, столбец или строка),
    // at — [строка, колонка] левого верхнего угла, size — [ширина в колонках, высота в строках]
    public function chart(array $opt): void
    {
        $this->charts[] = $opt;
    }
}

class XlsxChartBook
{
    private const STYLES = ['text' => 0, 'head' => 1, 'title' => 2, 'date' => 3, 'num' => 4, 'int' => 5, 'muted' => 6, 'headdate' => 7, 'label' => 8];

    /** @var XlsxChartSheet[] */
    private array $sheets = [];
    private array $strings = [];
    private array $stringIndex = [];

    public function sheet(string $name, array $widths = [], bool $rtl = false): XlsxChartSheet
    {
        $safe = mb_substr(trim(preg_replace('/[\\\\\/?*\[\]:]/u', ' ', $name)), 0, 31) ?: 'Sheet';
        $s = new XlsxChartSheet($safe, $widths, $rtl);
        $this->sheets[] = $s;
        return $s;
    }

    public static function excelDate(string $ymd): int
    {
        return (int)round((strtotime($ymd . ' 00:00:00 UTC') - strtotime('1899-12-30 00:00:00 UTC')) / 86400);
    }

    public static function col(int $i): string
    {
        $s = '';
        $i++;
        while ($i > 0) {
            $r = ($i - 1) % 26;
            $s = chr(65 + $r) . $s;
            $i = intdiv($i - 1, 26);
        }
        return $s;
    }

    private static function esc(string $s): string
    {
        return htmlspecialchars($s, ENT_QUOTES | ENT_XML1, 'UTF-8');
    }

    private function sid(string $s): int
    {
        if (!isset($this->stringIndex[$s])) {
            $this->stringIndex[$s] = count($this->strings);
            $this->strings[] = $s;
        }
        return $this->stringIndex[$s];
    }

    private static function ref(XlsxChartSheet $s, int $r1, int $c1, int $r2, int $c2): string
    {
        $name = "'" . str_replace("'", "''", $s->name) . "'";
        return $name . '!$' . self::col($c1) . '$' . ($r1 + 1) . ':$' . self::col($c2) . '$' . ($r2 + 1);
    }

    private static function cellValue(XlsxChartSheet $s, int $r, int $c)
    {
        $cell = $s->rows[$r][$c] ?? null;
        return is_array($cell) ? $cell[0] : $cell;
    }

    public function save(string $path): bool
    {
        $zip = new ZipArchive();
        if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) return false;

        $sheetXml = [];
        foreach ($this->sheets as $i => $s) $sheetXml[$i] = $this->sheetXml($s, $i);

        $chartNo = 0;
        $ct = '';
        foreach ($this->sheets as $i => $s) {
            $n = $i + 1;
            $ct .= '<Override PartName="/xl/worksheets/sheet' . $n . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
            $zip->addFromString("xl/worksheets/sheet$n.xml", $sheetXml[$i]);
            if (!$s->charts) continue;

            $ct .= '<Override PartName="/xl/drawings/drawing' . $n . '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>';
            $anchors = '';
            $rels = '';
            foreach ($s->charts as $k => $opt) {
                $chartNo++;
                $rid = 'rId' . ($k + 1);
                $zip->addFromString("xl/charts/chart$chartNo.xml", $this->chartXml($opt));
                $ct .= '<Override PartName="/xl/charts/chart' . $chartNo . '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>';
                $rels .= '<Relationship Id="' . $rid . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart' . $chartNo . '.xml"/>';
                [$r, $c] = $opt['at'];
                [$w, $h] = $opt['size'] ?? [9, 18];
                $anchors .= '<xdr:twoCellAnchor editAs="oneCell">'
                    . '<xdr:from><xdr:col>' . $c . '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' . $r . '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>'
                    . '<xdr:to><xdr:col>' . ($c + $w) . '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' . ($r + $h) . '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>'
                    . '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' . ($k + 2) . '" name="Chart ' . ($k + 1) . '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>'
                    . '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>'
                    . '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
                    . '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="' . $rid . '"/>'
                    . '</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>';
            }
            $zip->addFromString("xl/drawings/drawing$n.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                . '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                . $anchors . '</xdr:wsDr>');
            $zip->addFromString("xl/drawings/_rels/drawing$n.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' . $rels . '</Relationships>');
            $zip->addFromString("xl/worksheets/_rels/sheet$n.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing' . $n . '.xml"/>'
                . '</Relationships>');
        }

        $zip->addFromString('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            . '<Default Extension="xml" ContentType="application/xml"/>'
            . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            . '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
            . $ct . '</Types>');
        $zip->addFromString('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            . '</Relationships>');

        $sheets = '';
        $wbRels = '';
        foreach ($this->sheets as $i => $s) {
            $n = $i + 1;
            $sheets .= '<sheet name="' . self::esc($s->name) . '" sheetId="' . $n . '" r:id="rId' . $n . '"/>';
            $wbRels .= '<Relationship Id="rId' . $n . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . $n . '.xml"/>';
        }
        $cnt = count($this->sheets);
        $wbRels .= '<Relationship Id="rId' . ($cnt + 1) . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                 . '<Relationship Id="rId' . ($cnt + 2) . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>';
        $zip->addFromString('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            . '<sheets>' . $sheets . '</sheets></workbook>');
        $zip->addFromString('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' . $wbRels . '</Relationships>');
        $zip->addFromString('xl/styles.xml', $this->stylesXml());

        $si = '';
        foreach ($this->strings as $str) $si .= '<si><t xml:space="preserve">' . self::esc($str) . '</t></si>';
        $zip->addFromString('xl/sharedStrings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' . count($this->strings) . '" uniqueCount="' . count($this->strings) . '">' . $si . '</sst>');

        return $zip->close();
    }

    private function sheetXml(XlsxChartSheet $s, int $i): string
    {
        $pane = $s->freezeRows > 0
            ? '<pane ySplit="' . $s->freezeRows . '" topLeftCell="A' . ($s->freezeRows + 1) . '" activePane="bottomLeft" state="frozen"/>'
            : '';
        $views = '<sheetViews><sheetView ' . ($i === 0 ? 'tabSelected="1" ' : '') . 'rightToLeft="' . ($s->rtl ? 1 : 0) . '" workbookViewId="0">' . $pane . '</sheetView></sheetViews>';
        $cols = '';
        if ($s->widths) {
            $cols = '<cols>';
            foreach ($s->widths as $k => $w) $cols .= '<col min="' . ($k + 1) . '" max="' . ($k + 1) . '" width="' . (float)$w . '" customWidth="1"/>';
            $cols .= '</cols>';
        }
        $rows = '';
        foreach ($s->rows as $r => $cells) {
            $x = '';
            foreach ($cells as $c => $cell) {
                [$v, $style] = is_array($cell) ? [$cell[0], $cell[1] ?? 'text'] : [$cell, null];
                if ($style === null) $style = is_float($v) ? 'num' : (is_int($v) ? 'int' : 'text');
                $st = self::STYLES[$style] ?? 0;
                $ref = self::col($c) . ($r + 1);
                if ($v === null || $v === '') $x .= '<c r="' . $ref . '" s="' . $st . '"/>';
                elseif (is_int($v) || is_float($v)) $x .= '<c r="' . $ref . '" s="' . $st . '"><v>' . $v . '</v></c>';
                else $x .= '<c r="' . $ref . '" s="' . $st . '" t="s"><v>' . $this->sid((string)$v) . '</v></c>';
            }
            $rows .= '<row r="' . ($r + 1) . '">' . $x . '</row>';
        }
        $merges = '';
        if ($s->merges) {
            $merges = '<mergeCells count="' . count($s->merges) . '">';
            foreach ($s->merges as $m) $merges .= '<mergeCell ref="' . $m . '"/>';
            $merges .= '</mergeCells>';
        }
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            . ($s->fitWidth ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '')
            . $views . $cols . '<sheetData>' . $rows . '</sheetData>' . $merges
            . ($s->fitWidth ? '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' : '')
            . ($s->charts ? '<drawing r:id="rId1"/>' : '')
            . '</worksheet>';
    }

    private function stylesXml(): string
    {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            . '<numFmts count="3"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/><numFmt numFmtId="165" formatCode="#,##0.##"/><numFmt numFmtId="166" formatCode="dd.mm"/></numFmts>'
            . '<fonts count="4">'
            . '<font><sz val="11"/><color rgb="FF2B2320"/><name val="Calibri"/></font>'
            . '<font><b/><sz val="11"/><color rgb="FF371F20"/><name val="Calibri"/></font>'
            . '<font><b/><sz val="15"/><color rgb="FF844128"/><name val="Calibri"/></font>'
            . '<font><sz val="10"/><color rgb="FF7D726A"/><name val="Calibri"/></font>'
            . '</fonts>'
            . '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
            . '<fill><patternFill patternType="solid"><fgColor rgb="FFF1E3D2"/><bgColor indexed="64"/></patternFill></fill></fills>'
            . '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
            . '<border><left/><right/><top/><bottom style="thin"><color rgb="FFCDAA7C"/></bottom><diagonal/></border></borders>'
            . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            . '<cellXfs count="9">'
            . '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            . '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>'
            . '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
            . '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
            . '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
            . '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
            . '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
            . '<xf numFmtId="166" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
            . '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
            . '</cellXfs>'
            . '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            . '</styleSheet>';
    }

    // Значения диапазона [r1, c1, r2, c2] — столбец или строка листа
    private function cache(XlsxChartSheet $s, array $range, bool $num, ?string $fmt = null): string
    {
        [$r1, $c1, $r2, $c2] = $range;
        $cells = [];
        for ($r = $r1; $r <= $r2; $r++) for ($c = $c1; $c <= $c2; $c++) $cells[] = self::cellValue($s, $r, $c);
        $pts = '';
        foreach ($cells as $i => $v) {
            if ($v === null || $v === '') continue;
            $pts .= '<c:pt idx="' . $i . '"><c:v>' . ($num ? $v : self::esc((string)$v)) . '</c:v></c:pt>';
        }
        $count = count($cells);
        return $num
            ? '<c:numCache><c:formatCode>' . self::esc($fmt ?? 'General') . '</c:formatCode><c:ptCount val="' . $count . '"/>' . $pts . '</c:numCache>'
            : '<c:strCache><c:ptCount val="' . $count . '"/>' . $pts . '</c:strCache>';
    }

    private function chartXml(array $o): string
    {
        $s = $o['data'];
        $cat = $o['cat'];   // [r1, c1, r2, c2] — столбец или строка
        $val = $o['val'];
        $color = $o['color'] ?? '844128';
        $isLine = ($o['type'] ?? 'line') === 'line';

        $catRef = self::ref($s, $cat[0], $cat[1], $cat[2], $cat[3]);
        $valRef = self::ref($s, $val[0], $val[1], $val[2], $val[3]);
        $ser = '<c:ser><c:idx val="0"/><c:order val="0"/>'
            . '<c:tx><c:v>' . self::esc($o['title']) . '</c:v></c:tx>'
            . ($isLine
                ? '<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="' . $color . '"/></a:solidFill><a:round/></a:ln></c:spPr>'
                  . '<c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr><a:solidFill><a:srgbClr val="' . $color . '"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker>'
                : '<c:spPr><a:solidFill><a:srgbClr val="' . $color . '"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>')
            . '<c:cat><c:numRef><c:f>' . self::esc($catRef) . '</c:f>' . $this->cache($s, $cat, true, 'dd.mm.yyyy') . '</c:numRef></c:cat>'
            . '<c:val><c:numRef><c:f>' . self::esc($valRef) . '</c:f>' . $this->cache($s, $val, true) . '</c:numRef></c:val>'
            . ($isLine ? '<c:smooth val="0"/>' : '')
            . '</c:ser>';

        $scaling = '<c:orientation val="minMax"/>';
        if (isset($o['max'])) $scaling .= '<c:max val="' . $o['max'] . '"/>';
        if (isset($o['min'])) $scaling .= '<c:min val="' . $o['min'] . '"/>';

        $plot = $isLine
            ? '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' . $ser . '<c:marker val="1"/><c:axId val="5001"/><c:axId val="5002"/></c:lineChart>'
            : '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' . $ser . '<c:gapWidth val="40"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>';

        $txt = '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="5A4F48"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="ru-RU"/></a:p></c:txPr>';
        $axLine = '<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="D9CEC5"/></a:solidFill></a:ln></c:spPr>';

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            . '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            . '<c:roundedCorners val="0"/>'
            . '<c:chart>'
            . '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr>'
            . '<a:r><a:rPr lang="ru-RU" sz="1200" b="1"><a:solidFill><a:srgbClr val="371F20"/></a:solidFill></a:rPr><a:t>' . self::esc($o['title']) . '</a:t></a:r></a:p></c:rich></c:tx>'
            . '<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>'
            . '<c:plotArea><c:layout/>' . $plot
            . '<c:dateAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>'
            . '<c:numFmt formatCode="dd.mm" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>'
            . $axLine . $txt . '<c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblOffset val="100"/><c:baseTimeUnit val="days"/></c:dateAx>'
            . '<c:valAx><c:axId val="5002"/><c:scaling>' . $scaling . '</c:scaling><c:delete val="0"/><c:axPos val="l"/>'
            . '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="EBE3DC"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>'
            . '<c:numFmt formatCode="#,##0.##" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
            . $axLine . $txt . '<c:crossAx val="5001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>'
            . '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>'
            . '</c:plotArea>'
            . '<c:plotVisOnly val="1"/><c:dispBlanksAs val="' . ($isLine ? 'span' : 'gap') . '"/>'
            . '</c:chart>'
            . '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="EBE3DC"/></a:solidFill></a:ln></c:spPr>'
            . '</c:chartSpace>';
    }
}
