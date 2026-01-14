import requests,re
url='https://developer.8x8.com/jaas/docs/api-keys-jwt?docusaurus-data=1'
t=requests.get(url,timeout=20,headers={'User-Agent':'Mozilla/5.0'}).text
# find a JSON snippet that contains "room" and also "sub" nearby
pos=t.find('&quot;sub&quot;')
print('sub pos',pos)
print(t[pos-1200:pos+800])
