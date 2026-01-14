import re, requests, urllib.parse
q = urllib.parse.quote('lib-jitsi-meet jaas roomName vpaas-magic-cookie')
html = requests.get('https://duckduckgo.com/html/?q='+q, timeout=20, headers={'User-Agent':'Mozilla/5.0'}).text
links = re.findall(r'class="result__a" href="(.*?)"', html)
print('links',len(links))
for l in links[:10]:
  print(l)
