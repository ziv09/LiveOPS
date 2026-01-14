import re, requests
url='https://developer.8x8.com/jaas/docs/iframe-api-integration/'
t=requests.get(url,timeout=20,headers={'User-Agent':'Mozilla/5.0'}).text
print('len',len(t))
for pat in [r'vpaas-magic-cookie[^\s\"\']+', r'roomName[^\n]{0,120}', r'8x8\.vc[^\s\"\']+']:
    hits=re.findall(pat,t)
    print(pat,'->',hits[:5])
