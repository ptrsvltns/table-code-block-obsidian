import { FileSystemAdapter, MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownRenderer, MarkdownSectionInformation, MarkdownView, Notice, Plugin, setIcon, TFile } from 'obsidian';

import * as mine from 'mime-types';

import lang from './lang';

import { createElement } from './util/dom';
import { parseTableRowFromLine } from './util/markdown';

export interface TableCodeBlockSettings {
}

const DEFAULT_SETTINGS: TableCodeBlockSettings = {
}

type CellInfo = {
  el?: HTMLTableCellElement,
  row: Row,
  innerEl?: HTMLElement,
  borderEl?: HTMLElement,
  index: number
}

type Cell = {
  value: string,
  info: CellInfo
}

type RowInfo = {
  head: boolean,
  el?: HTMLTableRowElement,
  index: number
}

type Row = {
  cells: Array<Cell>,
  info: RowInfo
}

type TableInfo = {
  rowCount: number;
  columnCount: number;
}

type Table = {
  rows: Array<Row>,
  info: TableInfo
}

export default class TableCodeBlock extends Plugin {
  settings: TableCodeBlockSettings;

  async onload() {
    await this.loadSettings();

    const block = this.registerMarkdownCodeBlockProcessor("tb", async (source, el, ctx) => {
      const render = new RenderTable(this, ctx, el);
      render.loadTable(source);
      render.render();
    });
    block.sortOrder = -100;
  }

  onunload() {
    
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class RenderTable {

  public section: MarkdownSectionInformation;

  constructor(
    public plugin: TableCodeBlock,
    public ctx: MarkdownPostProcessorContext,
    public el: HTMLElement
  ) {
  }

  table: Table;
  selectedRow: Row | null = null;
  selectedCells: Array<Cell> = [];
  selectedCell: Cell | null = null;
  cellTextarea: HTMLTextAreaElement | null = null;
  bar: HTMLElement | null = null;

  updateIndex() {
    let columnCount = 0;
    let indexRow = 0;
    for (let r of this.table.rows) {
      let indexCell = 0;
      for (let c of r.cells) {
        c.info.index = indexCell;
        indexCell++;
      }
      if (columnCount < r.cells.length) columnCount = r.cells.length;
      r.info.index = indexRow;
    }
    this.table.info.rowCount = this.table.rows.length;
    this.table.info.columnCount = columnCount;
  }

  loadTable(content: string) {
    this.table = this.parseText(content);
  }

  isLine(data: Array<string>) {
    const reg = /^\-+$/;
    for (let i of data) {
      if (!reg.test(i)) return false;
    }
    return true;
  }

  parseText(content: string): Table {
    const table: Table = {
      rows: [],
      info: {
        rowCount: 0,
        columnCount: 0
      }
    };
    if (!content) return table;

    if (!content.includes("|")) {
      const exec = /([0-9]+)[^|]*x[^|]*([0-9]+)/gmi.exec(content);
      if (exec) {
        const rows = parseInt(exec[2]);
        const columns = parseInt(exec[1]);
        if (rows && columns) {
          for (let r = 0; r < rows; r++) {
            const row: Row = {
              cells: [],
              info: { head: false, index: r }
            };
            for (let c = 0; c < columns; c++) {
              row.cells.push({
                value: "",
                info: { index: c, row: row }
              })
            }
            table.rows.push(row);
          }
          return table;
        }
      }
    }

    const rows = content.trim().split("\n");
    let indexRow = 0;
    let indexLine = 0;
    for (let r of rows) {
      let cols = parseTableRowFromLine(r);
      if (this.isLine(cols)) {
        indexLine++;
        continue;
      }
      let head = false;
      if (indexLine !== rows.length - 1) {
        let nextCols = parseTableRowFromLine(rows[indexLine + 1]);
        head = this.isLine(nextCols);
      }
      const row: Row = {
        cells: [],
        info: { head, index: indexRow }
      };
      let indexCell = 0;
      for (let c of cols) {
        row.cells.push({
          value: c,
          info: { index: indexCell, row: row }
        })
        indexCell++;
      }
      if (table.info.columnCount < cols.length) table.info.columnCount = cols.length;
      table.rows.push(row);
      indexRow++;
      indexLine++;
    }
    for (let r of table.rows) {
      for (let c = r.cells.length; c < table.info.columnCount; c++) {
        r.cells.push({
          value: "",
          info: { index: c, row: r }
        });
      }
    }
    table.info.rowCount = table.rows.length;
    return table;
  }

  toMarkdown(table: Table) {
    const lines = [];
    for (let r of table.rows) {
      const line = [];
      for (let c of r.cells) {
        line.push(` ${c.value} `);
      }
      lines.push(`|${line.join("|")}|`);
      if (r.info.head) {
        const head = [];
        for (let c = 0; c < table.info.columnCount; c++) {
          head.push(" --- ");
        }
        lines.push(`|${head.join("|")}|`);
      }
    }
    return lines.join("\n");
  }

  fixCells(row: Row, length: number) {
    const cells = row.cells;
    for (let c = cells.length; c < length; c++) {
      cells.push({
        value: "",
        info: { index: c, row: row }
      });
    }
    return row;
  }

  saveCellTextareaValue() {
    if (!this.cellTextarea || !this.selectedCell || !this.selectedCell.info.el) return;
    let value = this.encryptCellValue(this.cellTextarea.value);
    const changed = this.selectedCell.value !== value;
    if (changed) this.selectedCell.value = value;
    try {
      if (this.cellTextarea.parentElement || this.cellTextarea.parentNode) this.cellTextarea.remove();
    } catch { }
    this.cellTextarea = null;
    this.selectedCell.info.el.removeClass("table-block-cell-edit");
    if (changed) this.saveTable();
  }

  encryptCellValue(value: string) {
    return value.replace(/\n/g, "<br line/>").replace(/`/g, "\\`");
  }

  convertCellValueForEdit(cell: Cell) {
    let value = cell.value;
    return value.replace(/\<br line\/\>/g, "\n").replace(/\\`/g, "`");
  }


  convertEmbedToMarkdown(value: string) {
    let reg = /!\[\[([^]*?)\]\]/gm;
    let matches = value.match(reg);
    if (matches) {
      for (let match of matches) {
        let exec = reg.exec(match);
        if (exec) {
          let link = decodeURI(exec[1]);
          const file = this.plugin.app.vault.getAbstractFileByPath(link);
          const type = file ? mine.lookup(file.path) : null;
          if (type && type.contains("image") && file) {
            if (this.plugin.app.vault.adapter instanceof FileSystemAdapter) {
              const url = "app://local/" + this.plugin.app.vault.adapter.getFullPath(file.path)
              while (true) {
                const temp = value.replace(match, `<img src="${encodeURI(url)}"/>`);
                if (value == temp) break;
                value = temp;
              }
            }
          } else {
            while (true) {
              const temp = value.replace(match, `[[${file?.path || link}]]`);
              if (value == temp) break;
              value = temp;
            }
          }
        }
      }
    }
    return value;
  }

  convertImageToMarkdown(value: string) {
    let reg = /!\[([^]*?)\]\(([^]*?)\)/gm;
    let matches = value.match(reg);
    if (matches) {
      for (let match of matches) {
        let exec = reg.exec(match);
        if (exec) {
          let render = exec[1];
          render = this.convertEmbedToMarkdown(render);
          let link = decodeURI(exec[2]);
          const file = this.plugin.app.vault.getAbstractFileByPath(link);
          const type = file ? mine.lookup(file.path) : null;
          if (type && type.contains("image") && file) {
            if (this.plugin.app.vault.adapter instanceof FileSystemAdapter) {
              const url = "app://local/" + this.plugin.app.vault.adapter.getFullPath(file.path)
              while (true) {
                const temp = value.replace(match, `<img src="${encodeURI(url)}" title="${render}"/>`);
                if (value == temp) break;
                value = temp;
              }
            }
          }
        }
      }
    }
    return value;
  }

  convertCellValueForMarkdown(cell: Cell) {
    let value = this.convertCellValueForEdit(cell);
    value = this.convertEmbedToMarkdown(value);
    value = this.convertImageToMarkdown(value);
    return value;
  }

  saveTimer: NodeJS.Timeout | null = null;
  saveTable() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        const content = this.toMarkdown(this.table);
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        const section = this.ctx.getSectionInfo(this.el);
        if (!view || !section) return;
        view.editor.replaceRange("```tb\n" + content + "\n```", {
          line: section.lineStart,
          ch: 0
        }, {
          line: section.lineEnd,
          ch: view.editor.getLine(section.lineEnd).length
        });
        view.requestSave();
      } catch { }
    }, 1);
  }

  clearSelect() {
    if (this.bar) this.bar.remove();
    this.bar = null;
    if (this.selectedRow) this.selectedRow.info.el!.removeClass("table-block-selected");
    this.selectedRow = null;
    if (this.selectedCells) this.selectedCells.forEach((c) => c.info.el!.removeClass("table-block-selected"));
    this.selectedCells = [];
    if (this.selectedCell) this.selectedCell.info.borderEl!.removeClass("table-block-cell-selected");
    this.selectedCell = null;
  }

  buttonBar() {
    const bar = createElement("div", {
      class: "table-block-tools",
      style: { position: "absolute", bottom: "0", left: "5px" }
    }, [
      createElement("div", null, [
        createElement("button", {
          style: {
            marginRight: "5px",
            marginBottom: "5px",
            cursor: "pointer"
          },
          text: lang.get("Set Head Row"),
          click: (_, e) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectedRow!.info.head = !this.selectedRow!.info.head;
            this.updateIndex();
            this.saveTable();
          }
        }),
        createElement("button", {
          style: {
            marginRight: "5px",
            marginBottom: "5px",
            cursor: "pointer"
          },
          text: lang.get("Remove Row"),
          click: (_, e) => {
            e.preventDefault();
            e.stopPropagation();
            this.table.rows.splice(this.selectedRow!.info.index, 1);
            this.updateIndex();
            this.saveTable();
          }
        }),
        createElement("button", {
          style: {
            marginRight: "5px",
            marginBottom: "5px",
            cursor: "pointer"
          },
          text: lang.get("Remove Column"),
          click: (_, e) => {
            e.preventDefault();
            e.stopPropagation();
            const selectedIndex = this.selectedCells[0].info.index;
            for (let r of this.table.rows) {
              r.cells.splice(selectedIndex, 1);
            }
            this.updateIndex();
            this.saveTable();
          }
        }),
      ]),
      createElement("div", null, [
        createElement("button", {
          style: {
            marginRight: "5px",
            marginBottom: "5px",
            cursor: "pointer"
          },
          text: lang.get("Insert To Left"),
          click: (_, e) => {
            e.preventDefault();
            e.stopPropagation();
            const selectedIndex = this.selectedCells[0].info.index;
            for (let r of this.table.rows) {
              r.cells.splice(selectedIndex, 0, {
                value: "",
                info: { index: 0, row: r }
              });
            }
            this.updateIndex();
            this.saveTable();
          }
        }),
        createElement("button", {
          style: {
            marginRight: "5px",
            marginBottom: "5px",
            cursor: "pointer"
          },
          text: lang.get("Insert To Right"),
          click: (_, e) => {
            e.preventDefault();
            e.stopPropagation();
            const selectedIndex = this.selectedCells[0].info.index;
            for (let r of this.table.rows) {
              r.cells.splice(selectedIndex + 1, 0, {
                value: "",
                info: { index: 0, row: r }
              });
            }
            this.updateIndex();
            this.saveTable();
          }
        }),
        createElement("button", {
          style: {
            marginRight: "5px",
            marginBottom: "5px",
            cursor: "pointer"
          },
          text: lang.get("Insert To Top"),
          click: (_, e) => {
            e.preventDefault();
            e.stopPropagation();
            let row: Row = { cells: [], info: { head: false, index: 0 } };
            this.fixCells(row, this.table.info.columnCount);
            this.table.rows.splice(this.selectedRow!.info.index, 0, row);
            this.updateIndex();
            this.saveTable();
          }
        }),
        createElement("button", {
          style: {
            marginRight: "5px",
            marginBottom: "5px",
            cursor: "pointer"
          },
          text: lang.get("Insert To Bottom"),
          click: (_, e) => {
            e.preventDefault();
            e.stopPropagation();
            let row: Row = { cells: [], info: { head: false, index: 0 } };
            this.fixCells(row, this.table.info.columnCount);
            this.table.rows.splice(this.selectedRow!.info.index + 1, 0, row);
            this.updateIndex();
            this.saveTable();
          }
        })
      ])
    ]);
    return bar;
  }

  async cellRenderMarkdown(cell: Cell) {
    if (!cell.info.el) return;
    const file = this.plugin.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
    if (file) {
      const conponent = new MarkdownRenderChild(cell.info.el);
      const el = cell.info.innerEl || document.createElement("div");
      if (el.parentElement !== cell.info.el || el.parentNode !== cell.info.el) cell.info.el.append(el);
      await MarkdownRenderer.renderMarkdown(this.convertCellValueForMarkdown(cell), cell.info.innerEl!, file.parent.path, conponent);
    }
  }

  createCellContent(cell: Cell) {
    if (!cell.info.el) return;
    cell.info.innerEl = createElement("div", { class: "table-block-cell" });
    cell.info.borderEl = createElement("div", { class: "table-block-cell-border" });
    cell.info.el.append(cell.info.innerEl);
    cell.info.el.append(cell.info.borderEl);
  }

  createCell(cell: Cell) {
    cell.info.el = createElement(cell.info.row.info.head ? "th" : "td", {
      style: { position: "relative", padding: "0" },
      click: () => {
        if (this.selectedCells) this.selectedCells.forEach((c) => c.info.el!.removeClass("table-block-selected"));
        if (this.selectedCell) this.selectedCell.info.borderEl!.removeClass("table-block-cell-selected");
        this.selectedCells = [];
        let cellIndex = cell.info.index;
        for (let x of this.table.rows) {
          const cell = x.cells[cellIndex];
          cell.info.el!.addClass("table-block-selected");
          this.selectedCells.push(cell);
        }
        this.selectedCell = cell;
        cell.info.borderEl!.addClass("table-block-cell-selected");
      },
      dblclick: (el) => {
        if (this.saveTimer) clearTimeout(this.saveTimer);

        try {
          if (this.cellTextarea && (this.cellTextarea.parentElement || this.cellTextarea.parentNode)) this.cellTextarea.remove();
        } catch { }
        this.cellTextarea = null;

        this.selectedCell = cell;
        el.addClass("table-block-cell-edit");
        this.cellTextarea = createElement("textarea", {
          class: "table-block-cell-textarea",
          value: this.convertCellValueForEdit(cell),
          on: {
            blur: (el) => {
              try {
                if (el.parentElement || el.parentNode) el.remove();
              } catch {}
              this.saveCellTextareaValue();
            }
          }
        });
        el.append(this.cellTextarea);
        this.cellTextarea.focus();
      }
    });
    this.createCellContent(cell);
    this.cellRenderMarkdown(cell);
    return cell;
  }

  async render() {
    this.selectedRow = null;
    this.selectedCells = [];

    const area = createElement("div", {
      class: "table-block-area",
      click: (el, e) => {
        if (el !== e.target) return;
        this.saveCellTextareaValue();
        this.clearSelect();
      }
    });
    const table = createElement("table", { style: { position: "relative" } });
    area.append(table);

    for (let r of this.table.rows) {
      await (async (r) => {
        let cols = r.cells;
        let row = createElement("tr", {
          style: { position: "relative" },
          click: (row, e) => {
            if (this.selectedRow && this.selectedRow.info.el !== row) this.selectedRow.info.el!.removeClass("table-block-selected");
            this.selectedRow = r;
            row.addClass("table-block-selected");
            if (!this.bar) {
              this.bar = this.buttonBar();
              area.append(this.bar);
            }
          }
        });
        r.info.el = row;
        let cellIndex = 0;
        for (let c of cols) {
          await (async (c, cellIndex) => {
            c.info.index = cellIndex;
            const cell = this.createCell(c);
            row.append(cell.info.el!);
          })(c, cellIndex);
          cellIndex++;
        }
        table.append(row);
      })(r);
    }

    const rightAdd = createElement("div", {
      class: "table-block-tools-button",
      style: {
        width: "18px",
        height: "18px",
        position: "absolute",
        right: "-24px",
        top: "50%",
        transform: "translate(0, -50%)",
        cursor: "pointer"
      },
      click: (_, e) => {
        e.preventDefault();
        e.stopPropagation();
        for (let r of this.table.rows) {
          r.cells.push({
            value: "",
            info: { index: this.table.info.columnCount, row: r }
          });
        }
        this.table.info.columnCount++;
        this.saveTable();
      }
    })
    setIcon(rightAdd, "plus", 18);
    table.append(rightAdd);

    const rightBottom = createElement("div", {
      class: "table-block-tools-button",
      style: {
        width: "18px",
        height: "18px",
        position: "absolute",
        left: "50%",
        bottom: "-24px",
        transform: "translate(-50%, 0)",
        cursor: "pointer"
      },
      click: (_, e) => {
        e.preventDefault();
        e.stopPropagation();
        let row: Row = { cells: [], info: { head: false, index: this.table.info.rowCount } };
        this.fixCells(row, this.table.info.columnCount);
        this.table.rows.push(row);
        this.table.info.rowCount = this.table.rows.length;
        this.saveTable();
      }
    })
    setIcon(rightBottom, "plus", 18);
    table.append(rightBottom);

    this.el.empty();
    this.el.append(area);


    this.el.append();
  }

}
