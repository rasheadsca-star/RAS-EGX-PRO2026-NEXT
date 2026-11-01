"""Ranking only among symbols that PASSED gates AND show an uptrend. Everything else = watchlist (unranked)."""
def split(rows):
    ranked=sorted([r for r in rows if r["trend"]],key=lambda a:(-a["score"],a["ticker"]))
    for i,r in enumerate(ranked,1):r["rank"]=i
    watch=sorted([r for r in rows if not r["trend"]],key=lambda a:a["ticker"])
    for r in watch:r["rank"]=None
    return ranked,watch
