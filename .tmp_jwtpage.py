import requests,re
url='https://developer.8x8.com/jaas/docs/api-keys-jwt?docusaurus-data=1'
t=requests.get(url,timeout=20,headers={'User-Agent':'Mozilla/5.0'}).text
print('len',len(t))
print('has room literal', '"room"' in t)
print('has context.user', 'context"' in t)
print('room snippets', re.findall(r'room.{0,80}', t)[:10])
