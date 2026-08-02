#!/usr/bin/env python3
"""
anikoto-bridge.py — search anikoto.tv and return download info.

Usage: python anikoto-bridge.py <title> <episode> <type>
  title:   anime title to search (e.g. "One Piece")
  episode: episode number (e.g. 1)
  type:    sub or dub

Returns JSON to stdout:
  { "ok": true, "url": "https://...m3u8", "source": "kiwi" }
  { "ok": false, "error": "Not found on anikoto.tv" }
"""

import sys
import json
import re
import requests
from bs4 import BeautifulSoup
from urllib.parse import quote_plus

ANIKOTO_DOMAIN = "https://anikoto.tv"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

def search_anikoto(title):
    """Search anikoto.tv and return the best-matching watch URL."""
    search_url = f"{ANIKOTO_DOMAIN}/search?keyword={quote_plus(title)}"
    try:
        resp = requests.get(search_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    
    # Find the first search result link pointing to /watch/
    for link in soup.select('a[href*="/watch/"]'):
        href = link.get("href", "")
        if "/watch/" in href and "/ep-" not in href:
            if href.startswith("/"):
                return f"{ANIKOTO_DOMAIN}{href}"
            return href
    
    # Fallback: try AJAX search endpoint
    try:
        ajax_url = f"{ANIKOTO_DOMAIN}/ajax/search"
        data = {"keyword": title}
        resp2 = requests.post(ajax_url, headers=HEADERS, data=data, timeout=10)
        if resp2.status_code == 200:
            soup2 = BeautifulSoup(resp2.text, "html.parser")
            for link in soup2.select('a[href*="/watch/"]'):
                href = link.get("href", "")
                if "/watch/" in href and "/ep-" not in href:
                    if href.startswith("/"):
                        return f"{ANIKOTO_DOMAIN}{href}"
                    return href
    except Exception:
        pass
    
    return None


def get_episode_source(watch_url, episode, audio_type):
    """
    Given a watch URL and episode number, extract the video source URL.
    Uses anikoto.tv's internal AJAX endpoints to get the stream URL.
    Returns (source_url, referer, provider_name) or None.
    """
    try:
        resp = requests.get(watch_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        return None

    html = resp.text
    soup = BeautifulSoup(html, "html.parser")
    
    # Extract video ID
    video_id_match = re.search(rf'{re.escape(ANIKOTO_DOMAIN)}/anime/getinfo/(\d+)', html)
    if not video_id_match:
        return None
    video_id = video_id_match.group(1)
    
    # Get episode data-ids
    try:
        ep_resp = requests.get(
            f"{ANIKOTO_DOMAIN}/ajax/episode/list/{video_id}",
            headers={**HEADERS, "X-Requested-With": "XMLHttpRequest"},
            timeout=10,
        )
        ep_soup = BeautifulSoup(ep_resp.text, "html.parser")
    except Exception:
        return None
    
    episode_data_id = None
    for ep_el in ep_soup.select(f'a[data-number="{episode}"]'):
        episode_data_id = ep_el.get("data-id")
        break
    
    if not episode_data_id:
        # Try any episode link matching the number
        for ep_el in ep_soup.select("a[data-number]"):
            if ep_el.get("data-number") == str(episode):
                episode_data_id = ep_el.get("data-id")
                break
    
    if not episode_data_id:
        return None
    
    # Get server options for this episode
    try:
        server_url = f"{ANIKOTO_DOMAIN}/ajax/server/list/{episode_data_id}"
        server_resp = requests.get(
            server_url,
            headers={**HEADERS, "X-Requested-With": "XMLHttpRequest"},
            timeout=10,
        )
        server_soup = BeautifulSoup(server_resp.text, "html.parser")
    except Exception:
        return None
    
    # Determine which server type to use based on audio preference
    # sub = any server, dub = look for dub-labeled servers
    servers = server_soup.select('a[data-link-id]')
    if audio_type == "dub":
        # Try to find a dub server
        for s in servers:
            text = s.get_text(" ", strip=True).lower()
            if "dub" in text:
                return extract_source_from_server(s, ANIKOTO_DOMAIN, audio_type)
        # Fallback to any server if no dub found
    elif audio_type == "sub":
        for s in servers:
            text = s.get_text(" ", strip=True).lower()
            if "sub" in text:
                return extract_source_from_server(s, ANIKOTO_DOMAIN, audio_type)
    
    # Fallback: use first available server
    if servers:
        return extract_source_from_server(servers[0], ANIKOTO_DOMAIN, audio_type)
    
    return None


def extract_source_from_server(server_el, domain, audio_type):
    """Extract the source video URL from a server element."""
    data_link_id = server_el.get("data-link-id", "")
    if not data_link_id:
        return None
    
    try:
        source_url = f"{domain}/ajax/server/{data_link_id}"
        source_resp = requests.get(
            source_url,
            headers={**HEADERS, "X-Requested-With": "XMLHttpRequest", "Referer": domain + "/"},
            timeout=15,
        )
        html = source_resp.text
    except Exception:
        return None
    
    # Try to find an iframe src
    import re
    iframe_match = re.search(r'<iframe[^>]+src="([^"]+)"', html, re.IGNORECASE)
    if iframe_match:
        iframe_url = iframe_match.group(1)
        if iframe_url.startswith("//"):
            iframe_url = "https:" + iframe_url
        # Follow the iframe to get the actual video URL
        try:
            iframe_resp = requests.get(
                iframe_url,
                headers={**HEADERS, "Referer": domain + "/"},
                timeout=15,
            )
            # Look for m3u8 URLs in the iframe page
            m3u8_match = re.search(r'(https?://[^"\'\\s]+\\.m3u8[^"\'\\s]*)', iframe_resp.text)
            if m3u8_match:
                return (m3u8_match.group(1), domain + "/", "unknown")
            
            # Try to find video source in JSON
            json_match = re.search(r'file:\\s*"(https?://[^"]+)"', iframe_resp.text)
            if json_match:
                return (json_match.group(1), domain + "/", "unknown")
        except Exception:
            pass
    
    # Look for direct m3u8 in the response
    m3u8_match = re.search(r'(https?://[^"\'\\s]+\\.m3u8[^"\'\\s]*)', html)
    if m3u8_match:
        return (m3u8_match.group(1), domain + "/", "unknown")
    
    return None


def main():
    if len(sys.argv) < 4:
        print(json.dumps({"ok": False, "error": "Usage: anikoto-bridge.py <title> <episode> <type>"}))
        sys.exit(1)
    
    title = sys.argv[1]
    episode = int(sys.argv[2])
    audio_type = sys.argv[3].lower()
    
    if audio_type not in ("sub", "dub"):
        print(json.dumps({"ok": False, "error": "type must be sub or dub"}))
        sys.exit(1)
    
    # Step 1: Search for the anime on anikoto.tv
    watch_url = search_anikoto(title)
    if not watch_url:
        print(json.dumps({"ok": False, "error": f"Not found on anikoto.tv: {title}"}))
        sys.exit(0)
    
    # Step 2: Get the source video URL
    result = get_episode_source(watch_url, episode, audio_type)
    if not result:
        print(json.dumps({"ok": False, "error": f"Could not extract source for ep {episode}"}))
        sys.exit(0)
    
    source_url, referer, provider = result
    print(json.dumps({
        "ok": True,
        "url": source_url,
        "referer": referer,
        "provider": provider,
        "watch_url": watch_url,
    }))


if __name__ == "__main__":
    main()
