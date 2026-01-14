import requests
url='https://developer.8x8.com/jaas/docs/api-keys-jwt?docusaurus-data=1'
t=requests.get(url,timeout=20,headers={'User-Agent':'Mozilla/5.0'}).text
for key in ['sub&quot;','aud&quot;','iss&quot;','context&quot;','room&quot;: &quot;']:
    i=t.find(key)
    print(key,i)
    if i!=-1:
        print(t[i-200:i+400])
        print('---')
