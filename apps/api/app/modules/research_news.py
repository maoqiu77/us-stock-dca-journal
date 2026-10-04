from __future__ import annotations

import re
from typing import Any

def _company_search_terms(payload: Any, ticker: str) -> list[str]:
    quotes = payload.get("quotes") if isinstance(payload, dict) else None
    candidates: list[str] = []
    for quote in quotes if isinstance(quotes, list) else []:
        if not isinstance(quote, dict):
            continue
        if str(quote.get("symbol") or "").upper() != ticker.upper():
            continue
        candidates.extend(
            str(quote.get(key) or "")
            for key in ("shortname", "longname", "displayName", "prevName")
        )
        break

    legal_suffixes = {
        "co",
        "company",
        "corp",
        "corporation",
        "inc",
        "incorporated",
        "ltd",
        "limited",
        "llc",
        "plc",
        "group",
        "holdings",
    }
    terms: list[str] = []
    for candidate in candidates:
        normalized = " ".join(re.findall(r"[a-z0-9]+", candidate.lower()))
        words = normalized.split()
        while words and words[-1] in legal_suffixes:
            words.pop()
        cleaned = " ".join(words)
        if cleaned:
            terms.append(cleaned)
        if words and len(words[0]) >= 4:
            terms.append(words[0])
    return list(dict.fromkeys(terms))


def _contains_news_term(text: str, term: str) -> bool:
    if not text or not term:
        return False
    return bool(
        re.search(
            rf"(?<![a-z0-9]){re.escape(term.lower())}(?![a-z0-9])",
            text.lower(),
        )
    )


def _related_ticker_symbols(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    symbols: list[str] = []
    for item in value:
        raw = item.get("symbol") if isinstance(item, dict) else item
        symbol = str(raw or "").split("|", 1)[0].strip().upper()
        if symbol:
            symbols.append(symbol)
    return symbols


def _news_relevance(
    ticker: str,
    title: str,
    summary: str,
    related_tickers: Any,
    company_terms: list[str],
) -> tuple[float, str]:
    combined = " ".join(item for item in (title, summary) if item)
    if _contains_news_term(combined, ticker):
        return 1.0, "ticker_mentioned"
    if any(_contains_news_term(combined, term) for term in company_terms):
        return 0.95, "company_mentioned"

    related = _related_ticker_symbols(related_tickers)
    if related and related[0] == ticker.upper():
        return 0.7, "primary_related_ticker"
    return 0.0, "weak_or_indirect"


def _deduplicate_news(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    for item in items:
        normalized_title = " ".join(
            re.findall(r"[a-z0-9]+", str(item.get("title") or "").lower())
        )
        url = str(item.get("url") or "").split("?", 1)[0].rstrip("/")
        key = normalized_title or url
        if not key:
            continue
        existing = selected.get(key)
        rank = (
            float(item.get("importanceScore") or 0),
            str(item.get("publishedAt") or ""),
        )
        existing_rank = (
            float(existing.get("importanceScore") or 0),
            str(existing.get("publishedAt") or ""),
        ) if existing else (-1.0, "")
        if existing is None:
            selected[key] = item
            continue
        preferred = item if item.get("summary") and not existing.get("summary") else existing
        fallback = existing if preferred is item else item
        merged = dict(preferred)
        merged["summary"] = str(preferred.get("summary") or fallback.get("summary") or "")
        merged["publishedAt"] = max(
            str(item.get("publishedAt") or ""),
            str(existing.get("publishedAt") or ""),
        )
        if rank > existing_rank:
            merged["relevance"] = item.get("relevance")
        merged["relevanceScore"] = max(
            float(item.get("relevanceScore") or 0),
            float(existing.get("relevanceScore") or 0),
        )
        merged["recencyWeight"] = max(
            float(item.get("recencyWeight") or 0),
            float(existing.get("recencyWeight") or 0),
        )
        merged["importanceScore"] = max(
            float(item.get("importanceScore") or 0),
            float(existing.get("importanceScore") or 0),
        )
        selected[key] = merged
    return list(selected.values())

