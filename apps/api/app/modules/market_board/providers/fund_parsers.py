from __future__ import annotations

import re
import json
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo
from html import unescape
from html.parser import HTMLParser


def parse_amount(value: str | None) -> str | None:
    if not value:
        return None
    match = re.search(r"([\d,.]+)\s*(?:万元|万)?", value)
    if not match:
        return None
    amount = Decimal(match.group(1).replace(",", ""))
    if "万" in value:
        amount *= 10000
    return format(amount.normalize(), "f")


def parse_nav_rows(rows: list[dict]) -> dict | None:
    valid = [row for row in rows if row.get("nav") not in (None, "") and row.get("date")]
    if not valid:
        return None
    valid.sort(key=lambda row: str(row["date"]), reverse=True)
    return valid[0]


def extract_js_json(text: str, variable: str):
    match = re.search(rf"var\s+{re.escape(variable)}\s*=\s*(\[.*?\]|\{{.*?\}})\s*;", text, re.S)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


def parse_nav_trend(text: str, now: datetime) -> dict | None:
    rows = extract_js_json(text, "Data_netWorthTrend")
    if not isinstance(rows, list):
        return None
    cutoff = now.timestamp() * 1000 + 60_000
    parsed = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("x"), (int, float)):
            continue
        if row["x"] > cutoff or not isinstance(row.get("y"), (int, float)):
            continue
        if row['y'] <= 0:
            continue
        observed = datetime.fromtimestamp(row["x"] / 1000, ZoneInfo('Asia/Shanghai')).date()
        parsed.append({"date": observed.isoformat(), "nav": str(row["y"]), "change_pct": str(row["equityReturn"]) if isinstance(row.get("equityReturn"), (int, float)) else None})
    return max(parsed, key=lambda row: row['date']) if parsed else None


def parse_asset_allocation(text: str, now: datetime) -> dict | None:
    data = extract_js_json(text, "Data_assetAllocation")
    if not isinstance(data, dict) or not isinstance(data.get("categories"), list):
        return None
    valid = [(index, value) for index, value in enumerate(data["categories"]) if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) and value <= now.date().isoformat()]
    if not valid:
        return None
    index, report_date = valid[-1]
    values = {str(series.get("name")): series.get("data", [])[index] for series in data.get("series", []) if isinstance(series, dict) and isinstance(series.get("data"), list) and len(series["data"]) > index}
    return {"report_date": report_date, "stocks_pct": str(values["股票占净比"]) if isinstance(values.get("股票占净比"), (int, float)) else None, "bonds_pct": str(values["债券占净比"]) if isinstance(values.get("债券占净比"), (int, float)) else None, "cash_pct": str(values["现金占净比"]) if isinstance(values.get("现金占净比"), (int, float)) else None}


class HoldingsHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth=0;self.section=None;self.sections=[];self.cell=None;self.row=[];self.header=False;self.in_heading=False
    def handle_starttag(self,tag,attrs):
        if tag=='div':
            self.depth+=1
            if 'boxitem' in dict(attrs).get('class','').split():
                self.section={'depth':self.depth,'heading':[],'rows':[]}
        if self.section is None:return
        if tag=='h4':self.in_heading=True
        if tag=='tr':self.row=[];self.header=False
        if tag in ('td','th'):
            self.cell=[];self.header=self.header or tag=='th'
    def handle_data(self,data):
        if self.section is not None and self.in_heading:self.section['heading'].append(data)
        if self.cell is not None:self.cell.append(data)
    def handle_endtag(self,tag):
        if tag in ('td','th') and self.cell is not None:
            self.row.append(''.join(self.cell).strip());self.cell=None
        if tag=='tr' and self.section is not None and self.row:
            self.section['rows'].append((self.header,self.row));self.row=[]
        if tag=='h4':self.in_heading=False
        if tag=='div':
            if self.section is not None and self.section['depth']==self.depth:
                self.sections.append(self.section);self.section=None
            self.depth-=1


def parse_holdings(text,now,instrument_key):
    parser=HoldingsHTMLParser();parser.feed(text)
    candidates=[]
    for section in parser.sections:
        match=re.search(r'20\d{2}-\d{2}-\d{2}',''.join(section['heading']))
        if not match:continue
        try:report=date.fromisoformat(match.group())
        except ValueError:continue
        if report>now.astimezone(ZoneInfo('Asia/Shanghai')).date():continue
        headers=[];stocks=[];ranks=set()
        for is_header,cells in section['rows']:
            if is_header:headers=cells;continue
            def column(label):
                index=next((i for i,h in enumerate(headers) if label in h),None)
                return cells[index] if index is not None and index<len(cells) else ''
            rank=column('序号');symbol=column('代码');name=column('名称');weight=column('占净值')
            if not rank.isdigit() or not 1<=int(rank)<=10 or int(rank) in ranks or not re.fullmatch(r'[A-Za-z0-9.-]{1,24}',symbol) or not name or not re.fullmatch(r'\d+(?:\.\d+)?%',weight):continue
            amount=Decimal(weight[:-1])
            if amount>100:continue
            ranks.add(int(rank));stocks.append(dict(rank=int(rank),symbol=symbol.upper(),name=name,weight_pct=str(amount)))
        if stocks:candidates.append((report.isoformat(),sorted(stocks,key=lambda s:s['rank'])))
    report,stocks=max(candidates,key=lambda pair:pair[0]) if candidates else (None,[])
    return dict(instrument_key=instrument_key,report_date=report,allocation=parse_asset_allocation(text,now),stocks=stocks)


def parse_purchase_state(text: str | None) -> tuple[str, str | None]:
    value = (text or "").strip()
    if re.search(r'暂停(?:申购|购买)', value):
        return "suspended", None
    if "不限额" in value or '无限额' in value:
        return "unlimited", None
    match = re.search(r'(?:单日累计购买上限|单日限额|限额|购买上限)[^\d]{0,15}([\d,.]+\s*(?:万元|万|元))', value)
    amount = parse_amount(match.group(1)) if match else None
    if amount is not None and Decimal(amount) > 0:
        return 'limited', amount
    return "unknown", None
