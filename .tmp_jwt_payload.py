import requests
url='https://developer.8x8.com/jaas/docs/api-keys-jwt?docusaurus-data=1'
t=requests.get(url,timeout=20,headers={'User-Agent':'Mozilla/5.0'}).text
start=t.find('&quot;aud&quot;')
print('start',start)
print(t[start:start+5000])
