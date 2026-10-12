#!/usr/bin/env python3
"""Playwright smoke/regression flow for any-destination weekend search."""

import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

SCREENSHOTS = Path(__file__).resolve().parents[1] / "docs" / "screenshots"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:3000")
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)

    console_errors = []
    page_errors = []
    failed_requests = []
    api_responses = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not args.headed)
        context = browser.new_context(viewport={"width": 1365, "height": 950}, locale="zh-CN")
        page = context.new_page()
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("requestfailed", lambda request: failed_requests.append({"url": request.url, "error": request.failure}))
        page.on("response", lambda response: api_responses.append({"url": response.url, "status": response.status}) if "/api/" in response.url else None)

        response = page.goto(args.url, wait_until="networkidle", timeout=60000)
        assert response and response.status == 200, f"首页响应异常：{response.status if response else 'no response'}"
        page.get_by_role("heading", name=re.compile("航线搜索")).wait_for(timeout=15000)

        origin = page.get_by_placeholder("出发城市")
        origin.fill("大连")
        page.get_by_role("button", name="大连", exact=True).last.click()
        page.get_by_role("button", name="目的地：任意").click()
        page.get_by_role("button", name="周末往返").click()
        assert page.get_by_text("未来 2 个周末").count() > 0, "默认周末数量不是 2"

        with page.expect_response(lambda item: item.url.endswith("/api/search") and item.request.method == "POST", timeout=30000) as search_event:
            page.get_by_role("button", name="搜索航班").click()
        search_response = search_event.value
        assert search_response.status == 200, f"搜索 API 返回 {search_response.status}"
        result = search_response.json()
        itineraries = result.get("itineraries", [])
        assert itineraries, f"未返回行程：{json.dumps(result.get('meta', {}), ensure_ascii=False)}"
        assert result["meta"]["destinationCount"] > 0
        assert all(item["outbound"]["stops"] == 0 for item in itineraries)
        assert all(not item.get("return") or item["return"]["stops"] == 0 for item in itineraries)
        assert any(item["return_status"] == "matched" for item in itineraries), "没有完整周末往返组合"
        assert page.locator("article").count() == len(itineraries), "列表卡片数量与 API 结果不一致"
        assert page.get_by_text("权益票库存：未核实").count() > 0

        first_article = page.locator("article").first
        first_article.scroll_into_view_if_needed()
        page.screenshot(path=str(SCREENSHOTS / "any-destination-desktop.png"))

        page.get_by_role("button", name="地图").click()
        page.locator('svg[aria-label*="航线分布图"]').wait_for(timeout=10000)
        page.screenshot(path=str(SCREENSHOTS / "any-destination-map.png"))
        page.get_by_role("button", name="列表").click()

        date_input = page.locator("#date")
        date_input.fill("2026-10-16")
        with page.expect_response(lambda item: item.url.endswith("/api/search") and item.request.method == "POST", timeout=30000) as second_search_event:
            page.get_by_role("button", name="搜索航班").click()
        second_response = second_search_event.value
        assert second_response.status == 200
        second_data = second_response.json()
        assert second_data["meta"]["requestedDates"], "修改日期后没有重新查询"
        assert page.locator("article").count() == len(second_data.get("itineraries", []))

        page.get_by_role("combobox").first.click()
        page.get_by_role("option", name="日期范围", exact=True).click()
        date_input.fill("2026-10-16")
        page.locator("#date_end").fill("2026-10-17")
        direct_only = page.get_by_label("只看直飞")
        assert direct_only.is_checked(), "日期范围应默认启用直飞过滤"
        direct_only.uncheck()
        with page.expect_response(lambda item: item.url.endswith("/api/search") and item.request.method == "POST", timeout=30000) as range_search_event:
            page.get_by_role("button", name="搜索航班").click()
        range_response = range_search_event.value
        assert range_response.status == 200, f"日期范围搜索 API 返回 {range_response.status}"
        range_data = range_response.json()
        assert range_data["meta"]["requestedDates"] == ["2026-10-16", "2026-10-17"]
        assert range_data["itineraries"], "指定日期范围没有返回行程"
        assert page.locator("article").count() == len(range_data["itineraries"])
        connecting = [item for item in range_data["itineraries"] if len(item["outbound"]["segments"]) > 1]
        if connecting:
            first_connection = connecting[0]["outbound"]["segments"]
            card = page.locator("article").filter(has_text=first_connection[0]["flight_no"]).first
            assert card.get_by_text("第 2 段").count() > 0, "中转行程未显示第二段"
            assert card.get_by_text(first_connection[1]["flight_no"]).count() > 0, "中转航班号未显示"

        page.get_by_role("combobox").last.click()
        page.get_by_role("option", name="目的地", exact=True).click()
        page.get_by_role("button", name="指定目的地").click()
        destination = page.get_by_placeholder("到达城市")
        destination.fill("天津")
        page.get_by_role("button", name="天津", exact=True).last.click()
        date_input.fill("2026-10-16")
        with page.expect_response(lambda item: item.url.endswith("/api/search") and item.request.method == "POST", timeout=30000) as precise_search_event:
            page.get_by_role("button", name="搜索航班").click()
        precise_response = precise_search_event.value
        assert precise_response.status == 200, f"精确路线 API 返回 {precise_response.status}"
        precise_data = precise_response.json()
        assert precise_data.get("routes"), f"大连-天津精确路线没有结果：{json.dumps(precise_data, ensure_ascii=False)}"

        mobile = context.new_page()
        mobile.set_viewport_size({"width": 390, "height": 844})
        mobile.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        mobile.on("pageerror", lambda error: page_errors.append(str(error)))
        mobile.on("requestfailed", lambda request: failed_requests.append({"url": request.url, "error": request.failure}))
        mobile.goto(args.url, wait_until="networkidle", timeout=60000)
        mobile.get_by_placeholder("出发城市").fill("大连")
        mobile.get_by_role("button", name="大连", exact=True).last.click()
        mobile.get_by_role("button", name="目的地：任意").click()
        mobile.get_by_role("button", name="周末往返").click()
        with mobile.expect_response(lambda item: item.url.endswith("/api/search") and item.request.method == "POST", timeout=30000) as mobile_search_event:
            mobile.get_by_role("button", name="搜索航班").click()
        mobile_response = mobile_search_event.value
        assert mobile_response.status == 200, f"移动端搜索 API 返回 {mobile_response.status}"
        mobile_data = mobile_response.json()
        assert mobile_data["itineraries"]
        mobile.locator("article").first.scroll_into_view_if_needed()
        mobile.screenshot(path=str(SCREENSHOTS / "any-destination-mobile.png"))
        mobile.get_by_role("button", name="地图").click()
        mobile.locator('svg[aria-label*="航线分布图"]').wait_for(timeout=10000)
        mobile_width = mobile.evaluate("({viewport: window.innerWidth, page: document.documentElement.scrollWidth})")
        assert mobile_width["page"] <= mobile_width["viewport"], f"移动端出现横向溢出：{mobile_width}"

        errors = {
            "console": console_errors,
            "page": page_errors,
            "failedRequests": failed_requests,
            "httpErrors": [item for item in api_responses if item["status"] >= 400],
        }
        assert not page_errors, f"浏览器运行时错误：{page_errors}"
        assert not console_errors, f"浏览器 Console 错误：{console_errors}"
        assert not failed_requests, f"网络请求失败：{failed_requests}"
        assert not [item for item in api_responses if item["status"] >= 400], f"HTTP 请求失败：{api_responses}"

        print(json.dumps({
            "homepageStatus": response.status,
            "searchStatus": search_response.status,
            "destinations": result["meta"]["destinationCount"],
            "itineraries": len(itineraries),
            "matchedRoundtrips": sum(item["return_status"] == "matched" for item in itineraries),
            "outboundOnly": sum(item["return_status"] == "not-found" for item in itineraries),
            "uncoveredDates": result["meta"]["uncoveredDates"],
            "rangeItineraries": len(range_data["itineraries"]),
            "connectingItineraries": len(connecting),
            "preciseRoutes": len(precise_data["routes"]),
            "mobileWidth": mobile_width,
            "screenshots": [
                str(SCREENSHOTS / "any-destination-desktop.png"),
                str(SCREENSHOTS / "any-destination-map.png"),
                str(SCREENSHOTS / "any-destination-mobile.png"),
            ],
            "browserIssues": errors,
        }, ensure_ascii=False, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
