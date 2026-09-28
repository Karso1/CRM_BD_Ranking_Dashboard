"""Shared upload/read-back/website verification for both environments."""
from collections import defaultdict
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def read_json(request, attempts=3):
    original = request if isinstance(request, urllib.request.Request) else urllib.request.Request(request)
    parsed = urllib.parse.urlsplit(original.full_url)
    apps_script_get = (original.get_method() == "GET" and parsed.scheme == "https"
        and parsed.hostname == "script.google.com" and parsed.path.startswith("/macros/s/")
        and parsed.path.endswith("/exec"))
    for attempt in range(attempts):
        current = original
        if apps_script_get:
            # ContentService redirects to a temporary result URL. Never reuse
            # a cached redirect, including between preflight and read-back.
            query = [(key, value) for key, value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
                if key != "_sync_request"]
            query.append(("_sync_request", uuid.uuid4().hex))
            headers = dict(original.header_items())
            headers.update({"Cache-Control": "no-cache, no-store", "Pragma": "no-cache"})
            current = urllib.request.Request(urllib.parse.urlunsplit(parsed._replace(
                query=urllib.parse.urlencode(query))), headers=headers, method="GET")
        try:
            with urllib.request.urlopen(current, timeout=130) as response:
                value = json.loads(response.read().decode("utf-8"))
            if not isinstance(value, dict):
                raise ValueError("接口返回格式不正确。")
            if value.get("error"):
                raise ValueError("接口返回错误，请检查授权、配置和接口日志。")
            return value
        except (OSError, ValueError) as error:
            expired_result = (apps_script_get and isinstance(error, urllib.error.HTTPError)
                and error.code == 404
                and urllib.parse.urlsplit(error.url).hostname == "script.googleusercontent.com"
                and urllib.parse.urlsplit(error.url).path == "/macros/echo")
            transient = isinstance(error, OSError) and (
                not isinstance(error, urllib.error.HTTPError) or error.code in {429, 500, 502, 503, 504}
                or expired_result)
            if not transient or attempt == attempts - 1:
                raise
            message = "Google 临时结果页返回 404，重新请求接口" if expired_result else "读取接口暂时失败，自动重试"
            print(f"{message} {attempt + 1}/{attempts - 1}…", flush=True)
            time.sleep(2 * (attempt + 1))


def dashboard_url(environment, platform, custom=None):
    host = "upay-bd-ranking-staging" if environment == "staging" else "upay-bd-ranking"
    expected = f"{host}.karsol.workers.dev"
    url = custom or f"https://{expected}/api/dashboard?platform={platform}&refresh=1"
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc != expected or parsed.path != "/api/dashboard":
        raise ValueError("网站刷新地址与目标环境不匹配，已停止。")
    query = dict(urllib.parse.parse_qsl(parsed.query))
    query.update(platform=platform, refresh="1")
    return urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))


def require_environment(payload, expected):
    if payload.get("error"):
        raise ValueError("接口返回错误，请检查授权、配置和接口日志。")
    if payload.get("environment") != expected:
        raise ValueError(f"环境校验失败：期望 {expected}，实际为 {payload.get('environment') or '未标记'}。")


def assert_source(periods, rows, targets, platform):
    """Compare every daily owner/agent metric and target, not just latest date."""
    def identity(date, owner, name, category):
        owner = str(owner or "UPay").strip().lower()
        name = str(name or owner).strip().lower()
        if platform == "wallet" and name == "unassigned":
            name = "upay"
        return (date, owner, name, "API" if platform == "business" and str(category).upper() == "API" else "代理商")

    expected, actual = defaultdict(lambda: [0.0] * 4), defaultdict(lambda: [0.0] * 4)
    for row in rows:
        key = identity(row["date"], row.get("bd"), row.get("agent"), row.get("category"))
        amounts = [row.get("consumption" if platform == "wallet" else "total_amount", 0),
            row.get("consumption", 0), row.get("open_card_virtual", 0), row.get("open_card_physical", 0)]
        for index, amount in enumerate(amounts):
            expected[key][index] += float(amount)
    target_expected, target_actual = defaultdict(float), defaultdict(float)
    for row in targets:
        target_expected[(str(row["month"]), str(row["bd"]).strip().lower())] += float(row.get("target", 0))
    for period in periods:
        for day in period.get("daily", []):
            for row in day.get("details", []):
                key = identity(day["date"], row.get("owner"), row.get("name"), row.get("type"))
                for index, field in enumerate(("recharge", "consumption", "cardsVirtual", "cardsPhysical")):
                    actual[key][index] += float(row.get(field, 0))
        for owner in period.get("overall", []):
            target_actual[(period["id"], str(owner["name"]).strip().lower())] += float(owner.get("target", 0))
    if expected.keys() != actual.keys():
        raise ValueError("云端日期或代理明细范围与本地不一致，不能确认本次发布。")
    for key in expected:
        for index, (left, right) in enumerate(zip(expected[key], actual[key])):
            if not math.isclose(left, right, rel_tol=1e-10 if index < 2 else 0, abs_tol=0.01 if index < 2 else 0):
                raise ValueError(f"云端明细金额/卡数与本地不一致（{key[0]}，{key[1]}，{key[2]}）。")
    for key in target_expected.keys() | target_actual.keys():
        if not math.isclose(target_expected[key], target_actual[key], rel_tol=1e-10, abs_tol=0.01):
            raise ValueError(f"云端月目标与本地不一致（{key[0]}，{key[1]}）。")


def sync(settings, rows, targets, platform, environment, website_url=None, verify_only=False):
    phase, posted = "读取本地文件", False
    try:
        if not rows:
            raise ValueError("每日数据为空，已停止同步。")
        refresh_url = dashboard_url(environment, platform, website_url)
        endpoint, key = settings["endpoint"], settings["key"]
        if not endpoint or not key:
            raise ValueError("同步地址或密钥为空。")
        url = endpoint + ("&" if "?" in endpoint else "?") + urllib.parse.urlencode({"key": key, "platform": platform})
        phase = "接口环境预检"
        print(f"{phase}…", flush=True)
        preflight = read_json(url)
        require_environment(preflight, environment)
        if verify_only:
            verification = preflight
        else:
            payload = {"rows": rows, "targets": targets} if platform == "wallet" else {"businessRows": rows, "businessTargets": targets}
            # Reject NaN/Infinity before POST instead of silently publishing zeros.
            encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
            request = urllib.request.Request(url, data=encoded, headers={"Content-Type": "application/json; charset=utf-8"}, method="POST")
            phase = "上传汇总数据"
            print(f"{phase}（{len(rows)} 行）…", flush=True)
            posted = True
            try:
                with urllib.request.build_opener(NoRedirect()).open(request, timeout=130) as response:
                    result = json.loads(response.read().decode("utf-8"))
                if not result.get("ok"):
                    raise ValueError("Google Sheet 拒绝写入，请检查接口日志。")
            except urllib.error.HTTPError as error:
                if error.code not in {301, 302, 303, 307, 308, 500, 502, 503, 504}:
                    raise
                print("上传响应需再次确认，正在读取云端核对，不重复上传…", flush=True)
            except OSError:
                print("上传响应超时，正在读取云端核对，不重复上传…", flush=True)
            phase = "读取上传后的云端数据"
            print(f"{phase}…", flush=True)
            verification = read_json(url)
            require_environment(verification, environment)
        periods = verification.get(platform, {}).get("periods", [])
        if not periods:
            raise ValueError("云端没有可验收的数据。")
        assert_source(periods, rows, targets, platform)
        phase = "刷新并核验网站数据"
        print(f"本地与云端的每日金额、卡数及月目标已核对，正在{phase}…", flush=True)
        refresh = urllib.request.Request(refresh_url, headers={"Accept": "application/json", "User-Agent": "UPay-Sync/2.0",
            "Authorization": f"Bearer {key}"})
        website = read_json(refresh)
        require_environment(website, environment)
        if website.get(platform, {}).get("periods") != periods:
            raise ValueError("网站数据与已验收的云端数据不一致。")
        print(f"验收通过：{len(rows)} 行、{len(periods)} 个月，截止 {max(row['date'] for row in rows)}；网站缓存已更新。", flush=True)
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        # Do not put secret-bearing request URLs or upstream response bodies in logs.
        reason = f"HTTP {error.code}" if isinstance(error, urllib.error.HTTPError) else (
            "网络读取失败/超时" if isinstance(error, OSError) else str(error))
        print(f"同步未完成（{phase}）：{reason}", flush=True)
        if posted or verify_only:
            print("请先运行对应环境的“仅验收”入口；它不会重新计算或上传。", flush=True)
        return 1
