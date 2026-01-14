import re, requests, urllib.parse
q = urllib.parse.quote('site:developer.8x8.com jaas lib-jitsi-meet min.js vpaas-magic-cookie')
html = requests.get('https://duckduckgo.com/html/?q='+q,timeout=20,headers={'User-Agent':'Mozilla/5.0'}).text
links = re.findall(r'class="result__a" href="(.*?)"', html)
print('found', len(links))
for l in links:
    u = requests.utils.unquote(l)
    if 'developer.8x8.com' in u:
        print(u)
