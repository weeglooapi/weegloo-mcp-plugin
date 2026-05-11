## API 설명

### CMA(Content Management API)
- Media, Content, ContentType, Locale, DeliveryAccessToken 등 Weegloo 에서 다루는 모든 리소스에 대한 CRUD 를 제공함
- API 호출을 위해서는 PersonalAccessToken 이나 Weegloo 의 Login 을 통해 얻어지는 OAuth Token 이 필요함
- OAuth Token 을 얻기 위해서는 skills/weegloo-web-hosting-fe-login 을 참고하면 됨.
- 사용자 서비스(Web/App 등 Frontend)에서 직접 CMA 를 사용하려면, skills/weegloo-web-hosting-fe-login 를 이용해야 함. 이외 방법은 보안에 위배됨
- Read 를 하기 위해서는 CMA 가 아닌 CDA 를 사용하기를 매우 권장함
- 예를들어 공개형 블로그 서비스를 만들었다면, 게시글 접근을 위해서는 DeliveryAccessToken 을 만들어서 CDA 를 이용한 Read 기능을 구현하고, 게시글 작성을 위한 API 는 skills/weegloo-web-hosting-fe-login 을 이용하여, OAuth Token 을 획득한 관리자만 CMA 를 이용하여 Write 할 수 있게 해야 함.
- API 주소는 https://cma.weegloo.com


### CDA(Content Delivery API)
- Media, Content, ContentType 에 대한 Read 를 제공함
- Cache 로직이 붙어 있으므로, Read 를 위해서는 CMA 대신 CDA 를 사용해야 함
- API 호출을 위해서는 DeliveryAccessToken 이 필요함.
- DeliveryAccessToken 은 Read 권한만 있으므로, 사용자 서비스(Web/App 등 Frontend)에 저장하여 사용해도 무관함.
- 단, 누구에게나 공개되어도 무관한 리소스에 대해서만 접근 가능하도록 DeliveryAccessToken 의 SpaceRole 설정을 신경써서 해 두어야 함.
- 예를들어 공개형 블로그 서비스를 만들었다면, 게시글에만 접근 가능한 DeliveryAccessToken 을 만들고, 서비스에 저장하여 사용하면 됨.
- API 주소는 https://cda.weegloo.com


### Service Login 기능
- Weegloo 의 회원/멤버십과 별개로 사용자가 소유한 Space 에서 제3의 '자체 회원관리 기능'을 사용할 수 있도록 기능을 제공함.
- 예를들어 Google 의 OAuth 2.0 기능을 이용하여, 자신(서비스 고유)만의 자체 회원관리 기능을 사용할 수 있음.
- 이때 자체 회원이 가지는 권한은 'ServiceLogin' 객체의 'sys.defaultRole' 이 참조하는 'ServiceUserRole' 을 따라감.
- 만약 특정 회원에 대해서 'sys.defaultRole' 이 아닌 다른 권한을 부여하려면, 특정 회원의 정보를 담는 객체인 'ServiceUser' 의 'roleOverride' 의 값으로 원하는 'ServiceUserRole' 의 참조를 넣어주면 됨
- 이렇게 'ServiceLogin' 기능을 통해서 로그인 한 User 가 획득하는 Token(Bearer Token)으로는 ACMA 와 ACDA 만 호출이 가능함


### ACMA(App Content Management API)
- 'ServiceLogin' 기능을 통해서 로그인 한 Space의 '자체 회원'만 호출이 가능한 API이며 사용용도나 사용법은 CMA 와 유사함
- 단, CMA 의 경우 권한이 부여된 모든 Resource 에 대해서 CRUD 가 가능한 반면, ACMA 는 자신이 생성한 Resource 에 대해서만 CRUD 가 가능함
- 예외적으로 'ServiceUser' 의 속성인 'isAdmin' 이 true 인 경우라면, 권한이 허용되는 버무이 내에서 타인이 생성한 Resource 에 대한 삭제가 가능함.
- 예를들어 회원제 게시판을 만들었다면, 글 작성시 ACMA 를 이용하면 됨. 읽기 위해서는 ACDA 를 이용.
- API 주소는 https://acma.weegloo.com

### ACDA(App Content Delivery API)
- 'ServiceLogin' 기능을 통해서 로그인 한 Space의 '자체 회원'만 호출이 가능한 API이며 사용용도나 사용법은 CDA 와 유사함
- 단, CDA 의 경우 DeliveryAccessToken 을 이용하므로 누구나 리소스에 접근 가능한 반면, ACDA 는 '자체 회원'에게 할당된 Resource 에 대해서만 Read 할 수 있음.
- 더불어 '자체 회원' 개개인별로 별도의 SpaceUserRole 을 각각 할당하여, 회원별로 Read 에 대한 권한을 커스터마이징 할 수 있음.
- 예를들어 회원제 게시판을 만들었다면, 글 읽기를 위해서 ACDA 를 이용하면 됨
- API 주소는 https://acda.weegloo.com


#### 서비스 유형에 따른 API 가이드

### 공개형 서비스
- 서비스 홈페이지와 같이 모두가 리소스를 Read 할 수 있는 서비스라면 CDA 를 이용.

### 공개형 서비스 & 관리자 페이지
- 서비스 홈페이지와 같이 모두가 리소스를 Read 할 수 있는 서비스라면 CDA 를 이용.
- 게시글을 관리하는 관리자 페이지를 별도로 둘 경우, skills/weegloo-web-hosting-fe-login 를 이용하여 Login 하고, CMA 를 이용하면 됨

### 회원만 읽을 수 있는 회원제 서비스
- 유료 회원만 볼 수 있는 회원제 게시판 서비스의 경우, 'ServiceLogin' 기능을 활성화하고, ACDA 를 사용하면 됨.

### 회원만 읽고 쓸 수 있는 회원제 서비스
- 'ServiceLogin' 기능을 활성화하고, 리소스 생성을 위해서는 ACMA 를 이용하면 됨.
- 회원만 읽을 수 있는 리소스에 대해서는 ACDA 를 사용하면 됨.
- 회원/비회원 모두 읽을 수 있는 리소스에 대해서는 CDA 를 이용하면 됨.
- 단 CDA 접근시에는 'DeliveryAccessToken' 이 필요하고, 적절한 'SpaceRole'을 설정해 두어야 함
- 마찬가지로 ACMA, ACDA 기능을 위해서는 적절한 'ServiceUserRole' 을 설정해 두어야 함


### 복합적인 서비스
- 누구나 읽을 수 있는 데이터를 접근하기 위해서는 'DeliveryAccessToken' 으로 CDA 를 호출하면 됨
- '자체 회원'이 리소스 생성을 할 수 있게 하려면 'ServiceLogin' 기능을 활성화하고 ACMA 를 이용하면 됨.
- '자체 회원'만 리소스 읽기를 가능하게 하려면 'ServiceLogin' 기능을 활성화하고 ACDA 를 이용하면 됨.
- 단 CDA 호출시에는 'DeliveryAccessToken' 이 필요하고, 적절한 'SpaceRole'을 설정해 두어야 함
- 마찬가지로 ACMA, ACDA 기능을 위해서는 적절한 'ServiceUserRole' 을 설정해 두어야 함