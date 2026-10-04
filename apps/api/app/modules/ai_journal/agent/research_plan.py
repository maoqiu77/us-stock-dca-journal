from __future__ import annotations

import re


def research_plan(question, previous=None, *, task_type='conversation'):
    """A visible default, not a restriction on the model's research decisions."""
    short = bool(re.search(r'明[后後]?天|后天|今天|盘中|日内|短线|两天|[12一二两]个?交易日|本周|tomorrow|intraday|next (?:two|2) days', question, re.I))
    long = bool(re.search(r'长期|长线|一年|几年|[一二三五十\d]+年|long.term', question, re.I))
    fundamentals = bool(re.search(r'估值|财报|财务|基本面|护城河|利润率|订单|valuation|fundamental|earnings', question, re.I))
    swing = bool(re.search(r'波段|下周|几周|一个月|本月|swing|next week', question, re.I))
    previous = previous or {}
    followup = bool(re.search(r'^(那|再|继续|现在呢|为什么|所以|如果|它|这只|这两|刚才|上次|把视角)|相比刚才|then|what about', question, re.I))
    horizon = 'short_term' if short else 'long_term' if long else 'swing' if swing else previous.get('horizon', 'general') if followup else 'long_term' if fundamentals else 'general'
    if horizon not in {'short_term', 'long_term', 'swing', 'general'}:
        horizon = 'general'
    portfolio = bool(re.search(r'我的持仓|我的仓位|我.*(?:持有|买了|买入了|成本|被套)|仓位|减仓|加仓|清仓|调仓|持仓|portfolio|my (?:position|holdings)', question, re.I)) or task_type == 'portfolio_review'
    intent = next((name for name, pattern in (
        ('fact_check', r'真假|属实|核实|查证|是真的吗|消息.*(?:可靠|可信)|fact.check'),
        ('comparison', r'比较|对比|相比|哪个|哪只|vs\.?|compare'),
        ('portfolio', r'持仓|仓位|减仓|加仓|清仓|调仓|被套|portfolio'),
        ('entry_exit', r'买不买|能不能买|能买吗|买入|追高|卖出|要不要卖|止盈|止损|适合买|buy|sell'),
        ('price_outlook', r'上涨|下跌|涨吗|跌吗|还能涨|走势|反弹|回调|涨跌|涨势'),
        ('fundamentals', r'利润|订单|财报|估值|基本面|护城河|长期|长线|earnings|valuation'),
        ('explanation', r'什么意思|是什么|怎么理解|解释|区别|为什么|what is|explain'),
    ) if re.search(pattern, question, re.I)), previous.get('intent', 'research') if followup else 'research')
    if portfolio and intent not in {'comparison', 'fact_check'}:
        intent = 'portfolio'
    if followup and not portfolio and re.search(r'^那我|^我的呢|按我的情况', question):
        portfolio, intent = True, 'portfolio'
    elif followup and intent == 'portfolio':
        portfolio = True
    focus = {
        'short_term': ['近期涨跌与成交量', '相对大盘表现', '未来几个交易日的消息催化', '上涨延续与转弱条件'],
        'swing': ['趋势与成交量', '相对大盘表现', '近期公司事件', '进出场条件'],
        'long_term': ['公司公告与财报原文', '增长与利润率的持续性', '估值依据与假设', '持有逻辑的失效条件'],
        'general': ['与问题直接相关的行情及新闻', '需要核实的关键原文', '结论与行动条件'],
    }[horizon]
    decision_focus = {
        'fact_check': ['明确待核实说法、事件日期和原始发布者', '找支持与反对的原文，区分确认、未证实和冲突'],
        'comparison': ['以相同时间区间和指标比较', '说明各自适合的条件，回答更倾向哪个'],
        'portfolio': ['相关持仓、成本及计划', '仓位集中度与调整顺序，明确覆盖范围'],
        'entry_exit': ['是否值得现在行动', '进入或退出的触发条件与失效条件'],
        'price_outlook': ['上涨或下跌的动力是否持续', '价格是否已反映消息，以及转强转弱信号'],
        'fundamentals': ['经营变化能否持续', '业绩、现金流、估值之间是否相互支持'],
        'explanation': ['直接解释用户问的概念或上一轮依据，不机械重做全部研究'],
        'research': ['直接回答用户的核心问题'],
    }
    if intent not in decision_focus:
        intent = 'research'
    brief = bool(re.search(r'简短|简洁|一句|两句|三句|两条|三条|只说|brief|concise', question, re.I))
    return {'version': 2, 'horizon': horizon, 'focus': focus, 'intent': intent,
            'decision_focus': decision_focus[intent], 'portfolio_relevant': portfolio,
            'followup': followup, 'answer_style': 'brief' if brief else 'standard',
            'answer_contract': {'summary_sentences': 1, 'action_items': 0 if intent in {'fact_check', 'explanation'} else 2, 'max_facts': 2 if brief else 4,
                                'target_characters': 400 if brief else 700},
            'label': {'short_term': '短线研究', 'swing': '波段研究', 'long_term': '长期研究', 'general': '综合研究'}[horizon],
            'secondary_fundamentals': short and (long or fundamentals),
            'probability_policy': '无经过验证的统计模型时给出方向倾向与条件，不编造上涨百分比。'}
