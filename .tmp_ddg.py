import re, requests, urllib.parse
q = urllib.parse.quote('site:developer.8x8.com jaas 8x8.vc vpaas-magic-cookie roomName')
url = 'https://duckduckgo.com/html/?q=' + q
html = requests.get(url, timeout=20, headers={'User-Agent':'Mozilla/5.0'}).text
links = re.findall(r'class="result__a" href="(.*?)"', html)
print('found', len(links))
for l in links[:10]:
    print(l)
