angular.module('chatapp.controllers', [])

  .run(function (FBFactory, $rootScope, UserFactory, Utils) {
    $rootScope.chatHistory = [];

    var baseChatMonitor = FBFactory.chatBase();

    var unwatch = baseChatMonitor.$watch(function (snapshot) {
      
      var user = UserFactory.getUser();

      if (!user) return;

        if (snapshot.event == 'child_added' || snapshot.event == 'child_changed') {
            var key = snapshot.key;

            if (key.indexOf(Utils.unescapeEmailAddress(user.email) >= 0)) {
                var otherUser = snapshot.key
                .replace(/_/g, '')
                .replace('chat', '')
                .replace(Utils.escapeEmailAddress(user.email), '');

                if ($rootScope.chatHistory.join('_').indexOf(otherUser) === -1) {
                    $rootScope.chatHistory.push(otherUser);
                }

                $rootScope.$broadcast('newChatHistory');

                /*
                *  TODO: PRACTICE
                *  Fire a local notification when a new chat comes in.
                *  Page 293
                */
            }
        }
    });
  })

.controller('MainCtrl', function($scope, Loader, $ionicPlatform, $cordovaOauth, FBFactory, GOOGLEKEY, GOOGLEAUTHSCOPE, UserFactory, currentAuth, $state) {
  $ionicPlatform.ready(function() {
    Loader.hide();

    // registrando um listener no escopo para ouvir um evento chamado 'showChatInterface' e um manipulador do evento
    $scope.on('showChatInterface', function($event, authData) {
      // evento 'showChatInterface' invocado
      if(authData.google) {
          authData = authData.google;
      }

      // salvando os dados do usuario autenticado no local storage
      UserFactory.setUser(authData);
      Loader.toggle('Redirecting..');

      // solicita ao FireBase todos os usuarios logados no sistema
      $scope.onlineusers = FBFactory.olUsers();

      // assim que tivermos a lista carregada, adicionamos os dados do usuario atual logado na lista
      $scope.onlineusers.$loaded().then(function () {
        $scope.onlineusers.$add({
                picture: authData.cachedUserProfile.picture,
                name: authData.displayName,
                email: authData.email,
                login: Date.now()
            })
            .then(function (ref) {
              // assim que o usuario atual for adicionado na lista, setamos um presenceId para ele e
              // adicionamos na lista de usuarios logados no local storage
              UserFactory.setPresenceId(ref.key());
              UserFactory.setOLUsers($scope.onlineusers);

              // redireciona o usuario logado para a interface de chats
              $state.go('tab.dash');
          });
      });

      return;
    });

    if(currentAuth) {
      // Se o obj currentAuth nao for nullo (usuario logado) invoca um evento chamado 'showChatInterface' 
      $scope.$broadcast('showChatInterface', currentAuth.google);
    }

    $scope.loginWithGoogle = function () {
      // usuario tentando se autenticar no sistema via google (clicou no botao :ogin With Google)
      Loader.show('Authenticating..');

      $cordovaOauth.google(GOOGLEKEY, GOOGLEAUTHSCOPE).then(function (result) {
          FBFactory.auth()
            .$authWithOAuthToken('google', result.access_token)
            .then(function (authData) {
                // usuario autenticado via google com sucesso - invocando um evento chamado 'showChatInterface'
                $scope.$broadcast('showChatInterface', authData);
            }, function (error) {
                Loader.toggle(error);
            });
      }, function (error) {
          Loader.toggle(error);
      });
    }
  });
})

.controller('DashCtrl', function($scope, UserFactory, $ionicPlatform, $state, $ionicHistory) {
  $ionicPlatform.ready(function () {
    // this is the main page, so if ther user clicks on the hardware back button he/she
    // will exit from the app because the nav history will be empty
    $ionicHistory.clearHistory();

    // get the online users list and display it
    $scope.users = UserFactory.getOLUsers();

    $scope.currUser = UserFactory.getUser();

    var presenceId = UserFactory.getPresenceId();

    // when the current user clicks on a username in the online users list redirect he/she to the chat detail
    $scope.redir = function (user) {
        $state.go('chat-detail', {
            otherUser: user
        });
    }
  });
})

.controller('ChatsCtrl', function ($scope, $rootScope, UserFactory, Utils, $ionicPlatform, $state) {
    $ionicPlatform.ready(function () {
        $scope.$on('$ionicView.enter', function (scopes, states) {
            var olUsers = UserFactory.getOLUsers();

            $scope.chatHistory = [];

            $scope.$on('AddNewChatHistory', function () {
                var ch = $rootScope.chatHistory,
                    matchedUser;

                for(var i = 0; i < ch.length; i++) {
                    for(var j = 0; j < olUsers.length; j++) {
                        if(Utils.escapeEmailAddress(olUsers[j].email) == ch[i]) {
                            matchedUser = olUsers[j];
                        }
                    };

                    if(matchedUser) {
                        $scope.chatHistory.push(matchedUser);
                    } else {
                        // user is not present in the online users list but the currentAuth
                        // user already had an interaction with he/she
                        $scope.chatHistory.push({
                            email: Utils.unescapeEmailAddress(ch[i]),
                            name: 'User Offline'
                        })
                    }
                };

            });

            // when the current user clicks on a username in the chat history list redirect he/she to the chat detail
            $scope.redir = function (user) {
                $state.go('chat-detail', {
                    otherUser: user
                });
            };

            // listenning the newChatHistory event broadcasted in the run() method
            $rootScope.$on('newChatHistory', function ($event) {
                $scope.$broadcast('AddNewChatHistory');
            });

            $scope.$broadcast('AddNewChatHistory');
        })
    });
})

.controller('ChatDetailCtrl', function ($scope, Loader, $ionicPlatform, $stateParams, UserFactory, FBFactory, $ionicScrollDelegate, $cordovaImagePicker, Utils, $timeout, $ionicActionSheet, $cordovaCapture, $cordovaGeolocation, $ionicModal) {
        $ionicPlatform.ready(function () {
            Loader.show('Estabilishing Connection...');
            // controller code here..

            $scope.chatToUser = $stateParams.otherUser;
            $scope.chatToUser = JSON.parse($scope.chatToUser);

            // usuario logado
            $scope.user = UserFactory.getUser();

            //cria um novo end point para o chat entre dois usuarios
            $scope.messages = FBFactory.chatRef($scope.user.email, $scope.chatToUser.email);
            $scope.messages.$loaded().then(function () {
                Loader.hide();
                $ionicScrollDelegate.scrollBottom(true);
            });

            // to add new chat messages in sicronized array ($firebaseaaray) on the server
            function postMessage(msg, type, map) {
                var d = new Date();
                d = d.toLocaleTimeString().replace(/:\d+ /, ' ');
                map = map || null;

                // adiciona msg no firebase, na url ctiada (and point criado acima)
                $scope.messages.$add({
                    content: msg,
                    time: d,
                    type: type,
                    from: $scope.user.email,
                    map: map
                });

                $scope.chatMsg = '';
                $ionicScrollDelegate.scrollBottom(true);
            }

            // when the user clicks on 'send' button, intending to send a mesage
            $scope.sendMessage = function () {
                if(!$scope.chatMsg) return;

                var msg = '<p>' + $scope.user.cachedUserProfile.name + ' says : <br/>' + $scope.chatMsg + '</p>';
                var type = 'text';

                postMessage(msg, type);
            }

            // ionic action sheet service to show option:Share Picture, Take Picture and Share Location
            $scope.showActionSheet = function () {
                var hideSheet = $ionicActionSheet.show({
                    buttons: [{
                        text: 'Share Picture'
                    }, {
                        text: 'Take Picture'
                    }, {
                        text: 'Share My Location'
                    }],
                    cancelText: 'Cancel',
                    cancel: function () {
                        // add cancel code..
                        Loader.hide();
                    },
                    buttonClicked: function (index) {
                        // pagina 301
                        
                        // Clicked on Share Picture
                        if(index === 0) {
                            Loader.show('Processing...');
                            var options = {
                                maximumImagesCount: 1
                            };
                            $cordovaImagePicker.getPictures(options)
                                .then(function (results) {
                                    if(results.length > 0) {
                                        var imageData = results[0];
                                        Utils.getBase64ImageFromInput(imageData, function (err, base64Img) {
                                            //Process the image string.
                                            // Salva a img em string base64 no Firebase 
                                            postMessage('<p>' + $scope.user.cachedUserProfile.name + ' posted : <br/><img class="chat-img" src="' + base64Img + '">', 'img');
                                            Loader.hide();
                                        });
                                    }
                                }, function (error) {
                                    // error getting photos
                                    console.log('error', error);
                                    Loader.hide();
                                });
                        }
                        // Clicked on Take Picture
                        else if(index === 1) {
                            Loader.show('Processing...');
                            var options = {
                                limit: 1
                            };

                            $cordovaCapture.captureImage(options).then(function (imageData) {
                                Utils.getBase64ImageFromInput(imageData[0].fullPath, function (err, base64Img) {
                                    //Process the image string. 
                                    postMessage('<p>' + $scope.user.cachedUserProfile.name + ' posted : <br/><img class="chat-img" src="' + base64Img + '">', 'img');
                                    Loader.hide();
                                });
                            }, function (err) {
                                console.log(err);
                                Loader.hide();
                            });
                        }
                        // clicked on Share my location
                        // mostra o mapa com a posicao do usuario num modal
                        else if(index === 2) {
                            $ionicModal.fromTemplateUrl('templates/map-modal.html', {
                                scope: $scope,
                                animation: 'slide-in-up'
                            }).then(function (modal) {
                                $scope.modal = modal;
                                $scope.modal.show();
                                $timeout(function () {
                                    $scope.centerOnMe();
                                }, 2000);
                            });
                        }
                        return true;
                    }
                });
            }

            // to work with the map in the modal, we will need a few mwthods to be defined on the scope

            // invoked when the map is created
            $scope.mapCreated = function (map) {
                $scope.map = map;
            };

            $scope.closeModal = function () {
                $scope.modal.hide();
            };

            // called when the map is iniialized
            $scope.centerOnMe = function () {
                if(!$scope.map) return;

                Loader.show('Getting current location...');
                var posOptions = {
                    timeout: 10000,
                    enableHighAccuracy: false
                };
                $cordovaGeolocation.getCurrentPosition(posOptions).then(function (pos) {
                    $scope.user.pos = {
                        lat: pos.coords.latitude,
                        lon: pos.coords.longitude
                    };
                    $scope.map.setCenter(new google.maps.LatLng($scope.user.pos.lat, $scope.user.pos.lon));
                    $scope.map.__setMarker($scope.map, $scope.user.pos.lat, $scope.user.pos.lon);
                    Loader.hide();

                }, function (error) {
                    alert('Unable to get location, please enable GPS to continue');
                    Loader.hide();
                    $scope.modal.hide();
                });
            };

            $scope.selectLocation = function () {
                var pos = $scope.user.pos;

                var map = {
                    lat: pos.lat,
                    lon: pos.lon
                };
                var type = 'geo';

                postMessage('<p>' + $scope.user.cachedUserProfile.name + ' shared : <br/>', type, map);
                $scope.modal.hide();
            }
        });
    })

    .controller('AccountCtrl', function($scope, FBFactory, UserFactory, $state) {
        $scope.logout = function() {
            // Unauthenticates a Firebase reference which had previously been authenticated
            FBFactory.auth().$unauth();

            // Remove user from Local Storage
            UserFactory.cleanUser();

            // Remove online user list from Local Storage
            UserFactory.cleanOLUsers();

            // remove presence
            var onlineUsers = UserFactory.getOLUsers();

            if(onlineUsers && onlineUsers.$getRecord) {
                var presenceId = UserFactory.getPresenceId();
                var user = onlineUsers.$getRecord();
                onlineUsers.$remove(user);
            }
            
            UserFactory.cleanPresenceId();
            $state.go('main');
        }
        
    });