import requests
url='https://developer.8x8.com/jaas/docs/api-keys-jwt?docusaurus-data=1'
t=requests.get(url,timeout=20,headers={'User-Agent':'Mozilla/5.0'}).text
idx=t.find('room&quot;')
print('idx',idx)
print(t[idx-500:idx+1200])
