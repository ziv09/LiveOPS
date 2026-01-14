import re, requests
url='https://developer.8x8.com/jaas/docs/iframe-api-integration/'
t=requests.get(url,timeout=20,headers={'User-Agent':'Mozilla/5.0'}).text
for pat in [r'xmpp-websocket[^<\n]{0,120}', r'lib-jitsi-meet[^<\n]{0,120}', r'libs/lib-jitsi-meet[^<\s\"\']+']:
    hits=re.findall(pat,t)
    print(pat, '->', hits[:10])
