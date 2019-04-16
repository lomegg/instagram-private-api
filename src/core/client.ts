import { State } from './state';
import { Request } from './request';
import { FeedFactory } from './feed.factory';
import { AccountRepository } from '../repositories/account.repository';
import { UserRepository } from '../repositories/user.repository';
import { MediaRepository } from '../repositories/media.repository';
import { ChallengeRepository } from '../repositories/challenge.repository';

export class IgApiClient {
  public state = new State();
  public request = new Request(this);
  public challenge = new ChallengeRepository(this);
  public account = new AccountRepository(this);
  public user = new UserRepository(this);
  public media = new MediaRepository(this);
  public feed = new FeedFactory(this);
}
