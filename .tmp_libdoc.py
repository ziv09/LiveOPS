import re, requests
url='https://developer.8x8.com/jaas/docs/enabling-with-lib-jitsi-meet-sdk/'
t=requests.get(url,timeout=20,headers={'User-Agent':'Mozilla/5.0'}).text
print('len',len(t))
for pat in [r'lib-jitsi-meet[^<\n]{0,120}', r'libs/lib-jitsi-meet[^<\s\"\']+', r'xmpp-websocket[^<\s\"\']+', r'serviceUrl[^<\n]{0,140}', r'JitsiConnection[^<\n]{0,140}', r'roomName[^<\n]{0,140}', r'8x8\.vc[^<\s\"\']+']:
    hits=re.findall(pat,t)
    print('\n',pat,'\n',hits[:10])
